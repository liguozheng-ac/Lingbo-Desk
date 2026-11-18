import { defineInvoke } from '@moeru/eventa'
import { getTraceFeedSource } from '@lingbo/stage-ui/composables/use-trace'
import { getSpeechBusContext, voiceGetTurns, voiceInterrupt } from '@lingbo/stage-ui/services/speech/bus'

import { selectSpeechTargets, speechTurnKey } from './lingbo-speech-targets'

/** Tracks playback and synthesis without saving spoken text. Stops keep turn ownership. */
export function attachVoiceDiagnostics(pinia, report) {
  const known = new Map()
  const handled = new Set()
  const events = []
  const firstTokens = new Set()
  let subscription
  let disposed = false
  let detectorWindows = 0
  let speechWindows = 0
  let lastDetectorAt = 0
  const context = getSpeechBusContext()
  const state = { events, traceReady: false, lastError: null }
  window.__voiceDiagnostics = state
  function mark(type, turn, details = {}) {
    const event = { type, at: performance.now(), wall: Date.now(), sessionId: turn?.sessionId, turnId: turn?.turnId, ...details }
    events.push(event)
    if (events.length > 1500)
      events.shift()
    void report('voice.timing', event)
  }
  function stampTurn(turn, controlOnly = false) {
    const key = speechTurnKey(turn)
    if (controlOnly && known.has(key))
      known.get(key).controlOnly = true
    if (!known.has(key)) {
      known.set(key, { sessionId: turn.sessionId, startedAt: Date.now(), controlOnly })
      if (known.size > 256) {
        const active = new Set(pinia._s.get('voice').activeTurns.map(speechTurnKey))
        const oldest = [...known.keys()].find(candidate => !active.has(candidate))
        if (oldest)
          known.delete(oldest)
      }
      mark('turn.started', turn)
    }
  }
  const chat = pinia._s.get('chat')
  const removeToken = chat.onTokenLiteral(async (literal, turn) => {
    const key = speechTurnKey(turn)
    if (literal && !firstTokens.has(key)) {
      firstTokens.add(key)
      if (firstTokens.size > 256)
        firstTokens.delete(firstTokens.values().next().value)
      mark('llm.first_token', turn)
    }
  })
  const removeOutput = pinia._s.get('speech').$onAction(({ name, args, after }) => {
    if (name !== 'createOutput')
      return
    const turn = args[0]
    stampTurn(turn)
    after((output) => {
      const originalStart = output.onPlaybackStart
      const originalEnd = output.onPlaybackEnd
      output.onPlaybackStart = (clip) => {
        mark('playback.started', turn, { segmentId: clip.id })
        originalStart?.(clip)
      }
      output.onPlaybackEnd = (clip, result) => {
        mark('playback.ended', turn, { segmentId: clip.id, status: result.status })
        originalEnd?.(clip, result)
      }
      if (output.synthesize) {
        const synthesize = output.synthesize
        output.synthesize = async (request, signal) => {
          mark('synthesis.started', turn, { segmentId: request.segmentId })
          try {
            const audio = await synthesize(request, signal)
            signal.throwIfAborted()
            mark('synthesis.finished', turn, { segmentId: request.segmentId, bytes: audio?.size || 0 })
            return audio
          }
          catch (error) {
            mark(signal.aborted ? 'synthesis.cancelled' : 'synthesis.failed', turn, { segmentId: request.segmentId })
            throw error
          }
        }
      }
    })
  }, true)
  const feed = getTraceFeedSource()
  void feed.subscribe((message) => {
    if (message.kind !== 'record')
      return
    const record = message.record
    if (record.type === 'sample.chunk' && record.track === 'participants/user/input') {
      const probabilities = record.values?.probability || []
      detectorWindows += probabilities.length
      speechWindows += probabilities.filter(value => value >= 0.6).length
      if (probabilities.length)
        lastDetectorAt = Date.now()
      return
    }
    if (!['span.begin', 'span.end', 'instant'].includes(record.type))
      return
    const safe = { type: record.type, track: record.track, spanId: record.spanId, ts: record.ts, clock: record.clock, observedTs: record.observedTs, status: record.status, turnId: record.ids?.turn, sessionId: record.ids?.conversation }
    if (record.reason === 'Speech segment was too short')
      safe.status = 'speech-too-short'
    if (record.track?.endsWith('/llm') && Number.isFinite(record.attrs?.['llm.ttft_ms']))
      safe.firstTokenMs = record.attrs['llm.ttft_ms']
    void report('voice.trace', safe)
  }, ['agents/agent/llm', 'participants/agent/tts', 'participants/agent/playback', 'participants/user/asr', 'participants/user/input', 'participants/user/speech'])
    .then((value) => {
      if (disposed)
        value.unsubscribe()
      else
        subscription = value
      state.traceReady = true
    })
    .catch((error) => { state.lastError = error.message })
  // Observe the listener independently of a chat turn. No audio, transcript or device ID leaves the window.
  const listenerTimer = setInterval(() => {
    const voice = pinia._s.get('voice')
    const devices = pinia._s.get('settings-audio-devices')
    if (!voice || !devices?.listening)
      return
    mark('listener.health', undefined, {
      status: voice.controller.activeInput?.state.phase || 'idle',
      audioFrame: voice.controller.audio?.position?.frame || 0,
      detectorWindows,
      speechWindows,
      detectorAgeMs: lastDetectorAt ? Date.now() - lastDetectorAt : -1,
      speaking: !!pinia._s.get('character-speaking')?.nowSpeaking,
      echoCancellation: !!devices.source?.echoCancellation,
      captureHeld: !!pinia._s.get('voice-capture-lease')?.held,
      recording: !!pinia._s.get('voice-messages')?.isRecording,
      listenerError: !!voice.error,
    })
  }, 5000)
  return {
    stampTurn,
    async stop(request) {
      if (!request.requestId || handled.has(request.requestId))
        return { status: 'duplicate', targets: 0 }
      const turns = await defineInvoke(context, voiceGetTurns)(undefined, { signal: AbortSignal.timeout(5000) })
      const targets = selectSpeechTargets(turns, known, request)
      handled.add(request.requestId)
      if (handled.size > 128)
        handled.delete(handled.values().next().value)
      mark('stop.requested', { sessionId: request.sessionId }, { requestId: request.requestId, targets: targets.length })
      if (targets.length) {
        const result = await defineInvoke(context, voiceInterrupt)({ turns: targets, cause: 'manual-chat' }, { signal: AbortSignal.timeout(5000) })
        if (result.status !== 'recorded')
          throw new Error('Speech stop was not recorded')
      }
      mark('stop.recorded', { sessionId: request.sessionId }, { requestId: request.requestId, targets: targets.length })
      return { status: 'recorded', targets: targets.length }
    },
    close() {
      disposed = true
      clearInterval(listenerTimer)
      removeToken()
      removeOutput()
      subscription?.unsubscribe()
    },
  }
}

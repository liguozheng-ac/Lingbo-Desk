import { useChatStore } from '@lingbo/stage-ui/stores/chat'
import { useChatSessionStore } from '@lingbo/stage-ui/stores/chat/session-store'
import { useProviderConfigStore } from '@lingbo/stage-ui/stores/providers/config'
import { useLlmToolsStore } from '@lingbo/stage-ui/stores/ai/chat-llm/tools'
import { useMemoryStore } from '@lingbo/stage-ui/stores/memory'
import { useConsciousnessStore } from '@lingbo/stage-ui/stores/modules/consciousness'
import { useHearingStore } from '@lingbo/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@lingbo/stage-ui/stores/modules/speech'
import { getActivePinia } from 'pinia'
import { toast } from 'vue-sonner'

import { parseCommand, personalInput } from './lingbo-commands'
import { attachVoiceDiagnostics } from './lingbo-voice'
import { bridgeSchemas } from './lingbo-work-schema'

// Only the main Stage owns this connection. Settings and chat windows share it.
const leader = new URL(location.href).searchParams.get('synced-leader') === 'true'
if (leader)
  start().catch(error => console.error('[Lingbo bridge]', error.message))

async function start() {
  let pinia
  for (let attempt = 0; attempt < 300; attempt++) {
    pinia = getActivePinia()
    if (pinia?._a)
      break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!pinia?._a)
    throw new Error('LINGBO stores did not become ready')
  const chat = useChatStore(pinia)
  const sessions = useChatSessionStore(pinia)
  const providers = useProviderConfigStore(pinia)
  const runtimeOrigin = window.__lingboRuntime?.gatewayOrigin
  const origin = runtimeOrigin || 'http://127.0.0.1:3850'
  const originURL = new URL(origin)
  if (originURL.protocol !== 'http:' || originURL.hostname !== '127.0.0.1' || originURL.origin !== origin)
    throw new Error('Invalid local gateway origin')
  if (runtimeOrigin) {
    const bootstrap = await fetch('/local-gateway-bootstrap').then(response => { if (!response.ok) throw new Error('Local gateway bootstrap failed'); return response.json() })
    if (bootstrap.baseURL !== origin + '/v1/' || !/^[a-f0-9]{64}$/.test(bootstrap.token))
      throw new Error('Invalid local gateway bootstrap')
    for (const [id, extra] of [['openai-compatible', {}], ['openai-compatible-audio-transcription', { model: 'local-paraformer' }], ['openai-compatible-audio-speech', { model: 'local-doubao-tts', voice: 'local-vivi' }]]) {
      if (providers.getProviderConfig(id)?.baseUrl)
        continue
      providers.ensureProvider(id, id)
      await providers.updateProviderConfig(id, { baseUrl: bootstrap.baseURL, apiKey: bootstrap.token, ...extra }, 'configured')
    }
    const consciousness = useConsciousnessStore(pinia), hearing = useHearingStore(pinia), speech = useSpeechStore(pinia)
    if (!consciousness.activeProvider) { consciousness.activeProvider = 'openai-compatible'; consciousness.activeModel = 'voice-agent-default' }
    if (!hearing.activeTranscriptionProvider) { hearing.activeTranscriptionProvider = 'openai-compatible-audio-transcription'; hearing.activeTranscriptionModel = 'local-paraformer' }
    if (!speech.activeSpeechProvider || speech.activeSpeechProvider === 'speech-noop') { speech.activeSpeechProvider = 'openai-compatible-audio-speech'; speech.activeSpeechModel = 'local-doubao-tts'; speech.activeSpeechVoiceId = 'local-vivi' }
  }
  const config = providers.getProviderConfig('openai-compatible')
  if (!config?.baseUrl || new URL(config.baseUrl).origin !== origin)
    return
  const headers = { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }
  const lifetime = new AbortController()
  const originalFetch = window.fetch.bind(window)
  const status = { ready: true, snapshots: 0, notices: 0, stops: 0, modelRequests: 0, lastTaskId: null, lastError: null }
  window.__lingboBridge = status
  const noticeKey = 'lingbo/validated-task-notices'
  const notified = new Set(JSON.parse(localStorage.getItem(noticeKey) || '[]'))
  const inputs = new Map()
  // Preserve native entries on disk while using the backend's explicit memory
  // for every new turn and work task. No hidden duplicate memory writes.
  useMemoryStore(pinia).enabled = false
  const toolStore = useLlmToolsStore(pinia)
  toolStore.addTools(...bridgeSchemas.map(schema => ({
    ...schema, id: schema.function.name, defaultActive: true,
    async execute(raw) {
      try {
        const args = typeof raw === 'string' ? JSON.parse(raw) : raw
        const sessionId = chat.activeSendSessionId || sessions.activeSessionId
        const turnId = inputs.get(sessionId)?.turnId || crypto.randomUUID()
        const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(args))))).map(b => b.toString(16).padStart(2, '0')).join('')
        const response = await originalFetch(`${origin}/work/${schema.function.name.endsWith('submit_work') ? 'submit' : 'control'}`, { method: 'POST', headers: { ...headers, 'X-Lingbo-Session': sessionId, 'X-Request-ID': `${turnId}:${fingerprint}` }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) })
        const result = await response.json()
        return JSON.stringify(response.ok ? result : { ok: false, error: result.error?.message || '工作任务请求失败' })
      }
      catch (error) { return JSON.stringify({ ok: false, error: error.message }) }
    },
  })))
  status.workToolNames = bridgeSchemas.map(s => s.function.name)
  const voice = attachVoiceDiagnostics(pinia, report)
  let heartbeat
  const removeBeforeSend = chat.onBeforeSend(async (message, context) => {
    const command = parseCommand(message)
    inputs.set(context.sessionId, { command, turnId: context.turnId, personal: personalInput(message) })
    voice.stampTurn(context, command?.action === 'stop_speech')
  })
  const removeAfterSend = chat.onAfterSend(async (_message, context) => {
    inputs.delete(context.sessionId)
  })

  // Add request ownership at the LLM action boundary. LINGBO can compose the user
  // text before inference, so command recognition uses its original send hook.
  const removeModelAction = pinia._s.get('llm').$onAction(({ name, args }) => {
    const options = args[3]
    const current = providers.getProviderConfig('openai-compatible')
    if (name === 'stream' && options?.providerId === 'openai-compatible' && current?.baseUrl && new URL(current.baseUrl).origin === origin) {
      const requestHeaders = new Headers(options.headers)
      const sessionId = chat.activeSendSessionId || sessions.activeSessionId
      requestHeaders.set('X-Lingbo-Session', sessionId)
      const command = inputs.get(sessionId)?.command
      const turnId = inputs.get(sessionId)?.turnId
      const personal = inputs.get(sessionId)?.personal
      if (personal)
        requestHeaders.set('X-Lingbo-Personal-Input', encodeURIComponent(personal))
      if (turnId)
        requestHeaders.set('X-Voice-Trace', turnId)
      if (command)
        requestHeaders.set('X-Lingbo-Command', command.action)
      status.modelRequests++
      const ownershipHeaders = Object.fromEntries(requestHeaders.entries())
      options.headers = ownershipHeaders
      const resolveStep = options.resolveStep
      if (resolveStep) {
        options.resolveStep = async () => {
          const next = await resolveStep()
          const request = next.chatProvider.generation(next.model)
          if (next.providerId !== 'openai-compatible' || new URL(request.config.baseURL).origin !== origin)
            return next
          return { ...next, headers: { ...next.headers, ...ownershipHeaders } }
        }
      }
    }
  }, true)
  addEventListener('pagehide', () => {
    lifetime.abort()
    clearInterval(heartbeat)
    voice.close()
    removeBeforeSend()
    removeAfterSend()
    removeModelAction()
    toolStore.removeToolsByIds(...bridgeSchemas.map(s => s.function.name))
  }, { once: true })
  async function report(type, data) {
    try {
      await originalFetch(`${origin}/bridge-event`, { method: 'POST', headers: { ...headers, 'X-Lingbo-Session': sessions.activeSessionId }, body: JSON.stringify({ type, data }), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]) })
    }
    catch { /* The status endpoint remains available after reconnect. */ }
  }
  async function snapshot(task) {
    status.snapshots++
    status.lastTaskId = task.id
    if (!['completed', 'cancelled', 'failed'].includes(task.status) || !sessions.sessionMetas[task.sessionId])
      return
    const key = `${task.id}:${task.status}`
    if (notified.has(key))
      return
    notified.add(key)
    localStorage.setItem(noticeKey, JSON.stringify([...notified].slice(-100)))
    const text = task.status === 'completed'
      ? `报告已经生成，可以在本机任务台${task.sourceId ? '下载 Word 报告' : '查看报告'}。`
      : task.status === 'cancelled' ? '报告任务已经取消。' : '报告任务失败，请在本机任务测试台查看错误。'
    toast(text)
    await chat.notifyConversation(task.sessionId, { source: 'lingbo-report-task', text: `聆泊任务 ${task.id}：${text} 请简短告知用户，不执行新任务。` })
    status.notices++
    await report('notice.accepted', { taskId: task.id, sessionId: task.sessionId, status: task.status })
  }
  async function handle(event) {
    if (event.type === 'work.snapshot') {
      const task = event.data
      if (!sessions.sessionMetas[task.sessionId]) return
      const key = `${task.id}:${task.approval?.id || task.status}`
      if ((['completed', 'failed', 'interrupted'].includes(task.status) || task.approval) && !notified.has(key)) {
        notified.add(key)
        localStorage.setItem(noticeKey, JSON.stringify([...notified].slice(-100)))
        const text = task.approval ? '工作任务需要确认，请打开本机任务台查看具体动作。' : task.status === 'completed' ? '工作任务已结束，可以在任务台查看产物和执行回执。' : '工作任务未完成，请在任务台查看原因。'
        toast(text)
        await chat.notifyConversation(task.sessionId, { source: 'lingbo-work-task', text: `${text} 任务编号 ${task.id}。这是状态通知，不执行新任务。` })
      }
      return
    }
    if (event.type === 'task.snapshot')
      return snapshot(event.data)
    if (event.type === 'speech.stop_requested' && sessions.sessionMetas[event.data.sessionId]) {
      const receipt = await voice.stop(event.data)
      status.stops++
      await report('speech.stopped', { sessionId: event.data.sessionId, ...receipt })
    }
  }
  async function synchronize() {
    const response = await originalFetch(`${origin}/status`, { headers, signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]) })
    if (!response.ok)
      throw new Error('Task status unavailable')
    const value = await response.json()
    for (const task of value.jobs) await snapshot(task)
  }
  await report('connected', { sessionId: sessions.activeSessionId })
  heartbeat = setInterval(report, 5000, 'heartbeat', {})
  while (!lifetime.signal.aborted) {
    try {
      const response = await originalFetch(`${origin}/events`, { headers, signal: lifetime.signal })
      if (!response.ok)
        throw new Error('Task event connection rejected')
      await synchronize()
      if (status.lastError)
        toast('聆泊任务连接已恢复。')
      status.lastError = null
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let pending = ''
      while (!lifetime.signal.aborted) {
        const { value, done } = await reader.read()
        if (done)
          break
        pending += value
        const frames = pending.split('\n\n')
        pending = frames.pop()
        for (const frame of frames) {
          const line = frame.split('\n').find(value => value.startsWith('data: '))
          if (line)
            handle(JSON.parse(line.slice(6))).catch((error) => { status.lastError = error.message })
        }
      }
    }
    catch (error) {
      if (!lifetime.signal.aborted) {
        if (!status.lastError)
          toast('聆泊任务连接已断开，正在自动重连；请勿重复提交任务。')
        status.lastError = error.message
      }
    }
    if (!lifetime.signal.aborted)
      await new Promise(resolve => setTimeout(resolve, 2000))
  }
}

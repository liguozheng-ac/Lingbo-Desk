// A delayed stop targets responses that existed at the user's stop request.
// It cannot stop a later reply or a response in another conversation.
export function speechTurnKey(turn) {
  return JSON.stringify([turn.sessionId, turn.turnId])
}

export function selectSpeechTargets(turns, known, request) {
  if (!Number.isFinite(request.requestedAt))
    throw new Error('停止请求缺少时间标识')
  return turns.filter((turn) => {
    const meta = known.get(speechTurnKey(turn))
    return turn.sessionId === request.sessionId && meta?.sessionId === turn.sessionId
      && !meta.controlOnly && meta.startedAt <= request.requestedAt
  })
}

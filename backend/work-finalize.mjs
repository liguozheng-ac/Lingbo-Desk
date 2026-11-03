// One receipt-only follow-up; it can never replay file/browser/script actions.
export async function runVerifiedWork(call, options) {
  const observations = []; let accepted = false;
  const onToolCall = (name, args, result) => {
    let value; try { value = typeof result === 'string' ? JSON.parse(result) : result; } catch { value = { preview: String(result).slice(0, 300) }; }
    if (name === 'work_finish' && value?.ok === true && ['complete', 'needs_input'].includes(value.outcome)) accepted = true;
    observations.push({ tool: name, action: args?.action, path: value?.path, sha256: value?.sha256, ok: value?.ok !== false, outcome: value?.outcome, error: value?.error, preview: JSON.stringify(value || '').slice(0, 400) });
    options.onToolCall?.(name, args, result);
  };
  let result = await call({ ...options, onToolCall });
  if (!accepted && !result.aborted && !options.signal?.aborted) {
    result = await call({ ...options, onToolCall, tools: ['work_finish'], messages: null, systemPrompt: '你只负责交工作验收回执。只能调用 work_finish，不能执行任何文件、浏览器、脚本动作，也不能仅用口头回复。根据真实工具结果判断用户要求是否全部完成；缺少操作或信息必须 outcome=needs_input。工具本身还会核验实际动作与文件哈希。', message: `原始任务：${options.message}\n已取得的实际工具结果摘要：${JSON.stringify(observations.slice(-16))}\n上一轮说明：${String(result.content || '').slice(0, 1200)}\n现在必须调用 work_finish，summary 只概括有证据的结果及未完成项。`, maxTokens: Math.min(options.maxTokens || 2000, 2000), toolLoopLimits: { maxRounds: 3, maxTotalCalls: 3 } });
  }
  return result;
}

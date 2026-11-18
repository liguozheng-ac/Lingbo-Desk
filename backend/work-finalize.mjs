import { createToolExecutionBudget } from '../engine/src/runtime/tool-execution-boundary.js';
export const REPORT_FACT_RULES = '生成报告或摘要时，先逐项复核数字、币种、单位、数量、付款比例及金额的来源。不同币种且资料没有提供带来源、日期和换算方向的汇率时，只能按原币列示金额，不得比较谁更便宜、金额更大或资金占用更多；付款比例更高不等于跨币种付款金额更大。允许比较明确的比例、数量、期限；缺少的信息标为待确认，不编造汇率、税率或交易条件。报告生成后用实际读取工具复核产物，再提交 work_finish；复核不保证业务正确，仍须人工审阅。Word 使用短标题和紧凑对比表，长校验值、完整路径及大段解释放在表格外的来源或正文中。';
// One receipt-only follow-up, with a shared hard budget across both model calls.
export async function runVerifiedWork(call, options) {
  const limit = options.toolLoopLimits?.maxTotalCalls ?? 48;
  const budget = createToolExecutionBudget(limit);
  const reserve = Math.min(3, Math.max(1, Math.floor(limit / 4)));
  const executionPolicy = { allowedTools: [...options.tools], budget };
  const observations = []; let accepted = false;
  const onToolCall = (name, args, result) => {
    let value; try { value = typeof result === 'string' ? JSON.parse(result) : result; } catch { value = { preview: String(result).slice(0, 300) }; }
    if (name === 'work_finish' && value?.ok === true && ['complete', 'needs_input'].includes(value.outcome)) accepted = true;
    observations.push({ tool: name, action: args?.action, path: value?.path, sha256: value?.sha256, ok: value?.ok !== false, outcome: value?.outcome, error: value?.error, preview: JSON.stringify(value || '').slice(0, 400) });
    options.onToolCall?.(name, args, result);
  };
  let result = await call({ ...options, systemPrompt: [options.systemPrompt, REPORT_FACT_RULES].filter(Boolean).join('\n'), onToolCall, executionPolicy, toolLoopLimits: { ...options.toolLoopLimits, maxTotalCalls: Math.max(1, limit - reserve) } });
  if (!accepted && !result.aborted && !options.signal?.aborted && budget.remaining > 0) {
    result = await call({ ...options, onToolCall, executionPolicy: { allowedTools: ['work_finish'], budget }, tools: ['work_finish'], messages: null, systemPrompt: '你只负责交工作验收回执。只能调用 work_finish，不能执行任何文件、浏览器、脚本动作，也不能仅用口头回复。根据真实工具结果判断用户要求是否全部完成；缺少操作或信息必须 outcome=needs_input。工具本身还会核验实际动作与文件哈希；没有内容验收条件时，只能说明已核验执行记录，不能保证业务结果正确。', message: `原始任务：${options.message}\n已取得的实际工具结果摘要：${JSON.stringify(observations.slice(-16))}\n上一轮说明：${String(result.content || '').slice(0, 1200)}\n现在必须调用 work_finish，summary 只概括有证据的结果及未完成项。`, maxTokens: Math.min(options.maxTokens || 2000, 2000), toolLoopLimits: { maxRounds: 3, maxTotalCalls: Math.min(reserve, budget.remaining) } });
  }
  return result;
}

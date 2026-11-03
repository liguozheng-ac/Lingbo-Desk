// Explicit commands keep ordinary conversation separate from file operations.
export function parseCommand(input) {
  const text = String(input).normalize('NFKC').trim().replace(/[。！!？?，,\s]+$/u, '')
  if (/^(?:生成测试报告|整理测试资料生成报告|创建测试报告|create (?:a )?test report|テストレポートを作成して)$/iu.test(text))
    return { action: 'create' }
  if (/^(?:别念了|别读了|停止播报|停止朗读|stop speaking|読み上げを止めて)$/iu.test(text))
    return { action: 'stop_speech' }
  if (/^(?:暂停报告任务|暂停报告|pause (?:the )?report(?: task)?|レポートを一時停止して)$/iu.test(text))
    return { action: 'pause' }
  if (/^(?:继续报告任务|恢复报告任务|继续报告|恢复报告|resume (?:the )?report(?: task)?|レポートを再開して)$/iu.test(text))
    return { action: 'resume' }
  if (/^(?:取消报告任务|取消报告|cancel (?:the )?report(?: task)?|レポートをキャンセルして)$/iu.test(text))
    return { action: 'cancel' }
  if (/^(?:报告任务进度|查询报告进度|报告做到哪了|报告做到哪里了|report progress|レポートの進捗)$/iu.test(text))
    return { action: 'progress' }
  if (/^(?:给报告增加日语摘要|报告增加日语摘要|add (?:a )?Japanese summary|日本語の要約を追加して)$/iu.test(text))
    return { action: 'modify', includeJapanese: true }
  return null
}

export function plainText(content) {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content))
    return content.filter(x => x?.type === 'text').map(x => x.text || '').join('\n')
  return ''
}

// LINGBO composes user text before model inference. Keep explicit personal
// commands tied to the original send hook rather than guessing inside context.
export function personalInput(input) {
  const text = plainText(input).trim();
  if (/^(?:请)?(?:帮我)?记住(?:了吗|了没|什么|吗)[。！？?!]?$/.test(text)) return null;
  if (!/^(?:(?:请)?(?:帮我)?记住|(?:查看|列出|看看)(?:我的)?(?:长期)?记忆|使用技能[：:])/.test(text)) return null;
  if (text.length > 1000) throw new Error('明确记忆或技能指令最多 1000 字，长资料请使用报告入口');
  return text;
}

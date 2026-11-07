import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSoak } from './soak-analysis.mjs';
const file = path.resolve(process.argv[2] || ''), output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(file), 'stability-report.md');
if (!process.argv[2]) throw new Error('Provide a completed soak-result.json');
const result = JSON.parse(fs.readFileSync(file, 'utf8')); if (!result.finishedAt) throw new Error('Do not report an unfinished run as complete');
const a = analyzeSoak(result), n = value => Number.isFinite(value) ? String(value) : '暂无可靠数据';
const time = iso => iso ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(iso)) : '未记录';
const faultNames = { 'upstream-offline-and-recovery': '本机模拟上游断连', 'backend-crash-auto-restart-and-manual-task-resume': '测试后端强制结束及恢复', 'observer-sse-reconnect': '独立 SSE 观察器重连' };
const status = result.passed && a.measurementCoveredRequestedWindow && !a.unexpectedGatewayPids.length ? '通过本轮功能基线检查' : '存在未通过或待复核项';
const image = path.join(path.dirname(file), 'resource-trends.png');
const lines = [
  `# Lingbo Desk ${result.version}：稳定性基线记录`, '',
  `结论：**${status}**。这是一轮受控本机样本，不证明长期无泄漏、所有真实任务可靠或完整语音稳定。`, '',
  '## 条件与窗口', '',
  `- 正式测量：${time(result.measurementStartedAt)} 至 ${time(result.samples.at(-1)?.at)}（北京时间）；实际 ${n(a.observedDurationSeconds)} 秒，目标 ${result.plannedDurationSeconds} 秒。启动预热前的进程拉起不计入该窗口。`,
  `- 采样 ${a.sampleCount} 次，目标间隔 ${result.sampleSeconds} 秒，最大实际采样间隔 ${n(a.maxSampleGapSeconds)} 秒；每次采样自身有执行开销。`,
  '- 实际便携 Electron、Node 后端和 Agent 工作进程；新建隔离数据目录，模型为本机确定性 Ollama 兼容测试服务，不运行真实模型权重。没有配置真实云服务密钥。',
  '- 麦克风关闭，不录音、不合成或播放真实音频，不让电脑休眠，不操作个人文档或已安装应用。角色窗口可见性/遮挡状态未固定。',
  '- 同机其他应用未隔离；测量期间运行过辅助回归检查及独立分析依赖下载。这是桌面功能稳定性基线，不是受控 CPU/耗电性能基准。', '',
  '## 任务与连接', '',
  `- 提交 ${a.taskCount} 个合成工作任务，完成 ${a.completedTasks} 个；其中 DOCX ${result.tasks.filter(t => t.office).length} 个，其余为文本。包含一个后端中断后显式继续的任务。`,
  '- 每个产物任务核对路径、指定内容和修改回执；正式结束时重新读取全部任务状态，核对没有漏任务或额外任务，每个任务只有一个成功修改回执。',
  `- 独立 SSE 观察器建立连接 ${result.sse.connections} 次，按本轮故障预期为 ${a.expectedObserverConnections} 次；收到心跳 ${result.sse.heartbeats} 次、事件 ${result.sse.events} 条。`,
  '- 完成快照按任务编号计数，检查每个任务恰好一次。这个观察器不是角色播放器，不能由此推断角色通知必达、音频没有重复播报或真人插话正常。',
  `- 采样时发现的空闲遗留工作进程次数：${a.idleWorkerSamples}。问题记录数：${result.issues.length}。程序退出及两个测试端口释放：${result.cleanExit ? '通过' : '未确认'}。`, '',
  '| 注入场景 | 测量开始后秒数 | 结果 |', '| --- | ---: | --- |',
  ...result.faults.map(f => `| ${faultNames[f.type] || f.type} | ${Math.round(f.atSeconds)} | ${f.recovered ? '恢复检查通过' : '未通过'}${f.recoveredAfterSeconds ? `；至完成续跑检查约 ${f.recoveredAfterSeconds} 秒，含刻意等待及任务执行` : ''} |`), '',
  '后端恢复检查：只结束本轮程序创建的后端 PID，由桌面启动器重新拉起。运行中任务保持“中断”，等待显式恢复请求；恢复后完成，未重复写入。SSE 演练主动断开的是测试观察连接，不是角色端连接。', '',
  '## 资源观察', '',
  '以下基线取预热后约第 3—5 分钟的中位数，空闲取最后约 5 分钟中位数；短跑模式按比例缩放窗口。私有字节是进程私有提交计数，不等于实际物理驻留内存，也不是显存。', '',
  '| 指标 | 预热后基线 | 最后空闲窗口 |', '| --- | ---: | ---: |',
  `| 主进程私有字节 MiB | ${n(a.mainBaseline.privateMiBMedian)} | ${n(a.mainCooldown.privateMiBMedian)} |`,
  `| 同名桌面进程私有字节合计 MiB | ${n(a.desktopFamilyBaselinePrivateMiB)} | ${n(a.desktopFamilyCooldownPrivateMiB)} |`,
  `| 主进程句柄中位数 | ${n(a.mainBaseline.handlesMedian)} | ${n(a.mainCooldown.handlesMedian)} |`,
  `| 程序所属进程数中位数 | ${n(a.mainBaseline.processCountMedian)} | ${n(a.mainCooldown.processCountMedian)} |`, '',
  `主进程空闲窗口私有字节斜率 ${n(a.mainCooldownPrivateSlopeMiBPerMinute)} MiB/分钟，句柄斜率 ${n(a.mainCooldownHandleSlopePerMinute)} 个/分钟；桌面同名进程私有字节合计斜率 ${n(a.desktopFamilyCooldownSlopeMiBPerMinute)} MiB/分钟。这些短窗口拟合值会受 GC、缓存和历史数据保留影响，不能单独认定泄漏。`, '',
  `空闲主进程 CPU 约 ${n(a.mainCooldownCpuPercentOfOneCore)}%，桌面同名进程约 ${n(a.desktopFamilyCooldownCpuPercentOfOneCore)}%（单核等效，100% 表示占满一个逻辑核；不是任务管理器整机口径）。未测显存、功耗或电池。`, '',
  '| 后端 PID | 首次/最后采样秒数 | RSS 最小/中位/最大 MiB |', '| --- | --- | --- |',
  ...a.gatewayEpochs.map(e => `| ${e.pid} | ${e.firstSeenSeconds} / ${e.lastSeenSeconds} | ${e.rssMiBMin} / ${e.rssMiBMedian} / ${e.rssMiBMax} |`), '',
  '后端按 PID 分段，不把重启后新进程的低 RSS 当成优化效果。桌面子进程身份变化、任务/聊天历史累积也需要单独解释；原始样本保留每个进程的私有字节、工作集、句柄、线程及 CPU 累计值。工作集直接相加可能重复统计共享页。', '',
  `诊断日志最多 ${a.maximumDiagnosticFiles} 个、${n(a.maximumDiagnosticKiB)} KiB。日志分组和已关闭文件保留数量有限；任务状态、聊天历史及产物是功能数据，继续积累，不按诊断日志规则自动删除。`, '',
  `复核提示：${a.reviewFlags.length ? a.reviewFlags.join('；') : '未触发本轮自动复核提示；这不等于证明无泄漏。'}`, '',
  ...(fs.existsSync(image) ? [`![资源时间曲线](${path.relative(path.dirname(output), image).replaceAll('\\', '/')})`, ''] : []),
  '## 实现与复现', '',
  '- `scripts/soak-windows-package.mjs`：原生程序启动、任务驱动、健康采样、受控故障、SSE 计数、退出和端口检查。',
  '- `scripts/windows-process-snapshot.ps1`：按本轮根 PID 收集后代进程指标，不读取其他应用命令行。',
  '- `backend/test-support/package-model.mjs`：本机模型夹具，可控制短时断连及中断任务的后续响应。',
  '- `scripts/soak-analysis.mjs`：预热/空闲中位数、同 PID 曲线及后端 epoch 分组；`backend/test/soak-analysis.test.mjs` 验证短跑、重启和渲染进程增长的解释边界。',
  '- `scripts/plot-soak.py`：可选离线 Matplotlib 图表，依赖放在独立分析目录，不修改应用的依赖。', '',
  '```powershell',
  "node scripts/soak-windows-package.mjs 'artifacts/Lingbo-Desk-0.3.4-test-win-x64' --duration-seconds 1800 --sample-seconds 15",
  "node scripts/soak-analysis.mjs '<本次工作目录>/soak-result.json'", '```', '',
  '本次数据目录：`artifacts/' + path.basename(path.dirname(file)) + '`。记录包括 `soak-result.json`、`samples.jsonl`、`samples.csv`、`analysis-summary.json` 和图表。短跑试验单独保存，不能替代正式窗口。', '',
  '## 未覆盖', '',
  '真实 ASR/TTS 与持续语音会话、自然打断/回声/重复播报、长时多日运行、真正睡眠/唤醒、真实网络断开、GPU 显存和耗电、任意脱离进程、干净 Windows 部署及安装升级仍未验证。没有运行真实账户操作。', '',
  '本轮增加测试与统计脚本，没有修改产品核心逻辑；便携版仍为 0.3.4-test，不因补测而生成新版本。现有安装版与 GitHub 均未更新。', '',
];
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, lines.join('\n'));
console.log(JSON.stringify({ report: output, observedSeconds: a.observedDurationSeconds, functionalPassed: result.passed, coveredWindow: a.measurementCoveredRequestedWindow }));

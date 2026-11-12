# 0.3.5 本地版本收口记录

后续验收更新：用户已对当前 0.3.5 完整语音复测反馈“都没问题”，真实 DeepSeek 任务的小样本验收也已完成。详见 [0.3.5 验收记录](acceptance-0.3.5.md)。下文“未重复真人验收”描述的是安装收口当时的状态。

日期：2026-11-12（Asia/Shanghai）。本轮目标是统一源码、现有修复、原创角色与 Windows 安装包，保留现有数据；不发布 GitHub，不增加业务功能。

## 内容

- 历史语音附件兼容读取进入统一构建，避免旧引用被当成 Base64 解码而阻塞会话。
- 本地版本账号登录防循环、窗口安全导航保护进入同一构建。
- 原创 Live2D 角色 B 作为预设资源打包，已有导入角色继续使用原记录；Hiyori 不删除。
- 修复拖动控件的异步平台判断：原先把 `isLinux()` 返回的 Promise 当作布尔值，Windows 原生拖动入口因此未注册到按钮。现在等待探测结果，并在 Windows 鼠标按下时调用原有原生拖动接口，Linux 继续用 CSS 拖动区。
- 根包、桌面包与打包元数据统一为 0.3.5。打包脚本支持目录包与 NSIS，保留原安装 GUID `6370a693-3c55-52e9-b49b-093e3d2ec67c`、当前用户安装、中文快捷方式和卸载时保留数据的规则。

关键源码：`desktop/packages/stage-ui/src/libs/chat-asset-reference.ts`、`desktop/packages/stage-ui/src/libs/chat-assets.ts`、`desktop/packages/stage-ui/src/database/repos/chat-assets.repo.ts`；`desktop/apps/stage-tamagotchi/src/main/services/lingbo/auth.ts`、`src/main/windows/shared/window.ts`；`desktop/packages/stage-ui/src/stores/display-models.ts`；`desktop/apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/index.vue`；`scripts/package-desktop.mjs`、`scripts/package-desktop.config.cjs`、`scripts/package-payload.mjs`。

## 升级策略

安装版 0.3.0 与当前源码的启动器、服务目录和凭据存储方式不同，不能只更新桌面 ASAR。新版使用 `resources/service/backend/server.mjs`，依赖包内 Node/Python，数据仍位于 `%LOCALAPPDATA%/LingboDesk/.local`，角色存储来源仍为 `http://localhost:5173`。

升级前经 Settings → File → Exit 正常退出日常程序，备份完整程序目录和 `.local` 数据，共 24,342 个文件、2,573,062,452 字节，逐文件 SHA256 一致。备份包含私人历史，只存在忽略的私有构建目录。

本机旧版从个人加密文件读取服务配置，新版使用 `.local/services.dpapi`。本轮在同一 Windows 用户下将三个现有服务字段直接转换为新版 CurrentUser DPAPI 存储，没有输出密钥、生成明文文件或修改旧密钥文件。新版配置类读取校验通过，三个字段均为 encrypted/configured，warning 为空。该操作是本机升级准备脚本完成的，**不是通用安装器自动迁移任何旧密钥目录的功能**。

## 验证及证据边界

| 检查 | 结果与边界 |
| --- | --- |
| 后端现有测试 | 127 项通过，在有项目依赖的构建工作区运行，显式指定已验证 Python 运行时。直接在无依赖的源码目录运行曾有 12 项失败，主要是 Python 文档库及服务依赖缺失，失败日志保留，不据此宣称任意机器无配置可运行测试 |
| 账号与窗口专项 | 3 个文件、23 项通过 |
| 桌面构建 | 完成；现有配置扩展名及打包可选平台依赖警告保留，不当作错误或已解决问题 |
| 冷备份副本升级链路 | 295 条原消息可加载，实际 stores/submit 收到本机模拟模型回复，原消息前缀不变；原创角色 ZIP SHA256 匹配原件。首次测试按显示名称判断角色过早失败，改为等待模型可用并验证内容散列后通过 |
| 拖动回归 | 浏览器测试覆盖异步 Windows 平台判断及 Linux CSS 路径；同一名称过滤还覆盖既有滚动条拖动。使用本机 Chrome 与独立测试配置，因为 Playwright 预期的浏览器版本未安装；贴纸资产缺失按生产构建相同方式排除，未宣称完整浏览器测试套件通过 |
| 人工拖动 | 用户对原生拖动修复的测试窗口明确反馈“能正常移动”，作为现场反馈记录；不是自动测量位移或延迟 |
| 程序包受控场景 | 实际 Electron/Node/Python、工作进程、文件、DOCX、暂停修改恢复、取消、报告检查点、音频解码、退出清理及诊断隐私。采用本机确定性模型，不代表真实云端模型任务成功率 |
| 包检查 | 检查服务源码/运行时/SQLite/Python 锁、链接、个人配置文件和已知凭据形态；不是能发现所有秘密的通用扫描器 |

自动化拖动未观察到有效位移；原生插件调用后只读快照停止刷新，专用测试进程后续经身份核验后清理，日常程序没有被强制结束。曾试验专用 CSS 系统拖动柄，自动化也未证明其有效；该试验已撤回，最终采用用户实测通过的原生拖动修复。不能把自动化输入不兼容直接定性为所有真人拖动都会挂起，也不能用用户反馈倒推出自动化位移测试通过。

会话修复前一轮已获得真人语音回复、嘴型及自然插话正常反馈；本轮新完整安装包的自动测试没有代替真人发声，没有新增语音首响应时间、误打断率或长期稳定性统计。

## 构建来源与限制

完整打包 CLI 的依赖解析因 npm registry 网络错误超时，失败目录和日志保留。最终本机构建使用此前已验证的依赖载荷缓存：核对 Node 依赖声明、engine npm lock、Python wheel lock 一致，复制当前服务源码，重新检查 SQLite ABI、Python 实际依赖集合，重新构建 Electron 桌面和 NSIS。构建记录明确标记缓存来源和实际工具版本。

这证明本机现有依赖条件下能够装配，不是全新机器冷构建成功或字节一致可复现的证明。安装器未做代码签名。此本地包包含个人已取得的其他模型/Core 资源，不等于获得公开分发全部素材的授权。源代码 MIT 与素材许可分别处理。

本机记录目录：`artifacts/release-0.3.5/`。最终采用 `bundle-final/package/Lingbo-Desk-0.3.5-Setup.exe`；`bundle-approved` 是已撤回的 CSS 试验包，禁止作为交付包混用。备份、会话副本、密钥迁移结果及测试数据不进入安装器或 Git。

## 安装升级状态

本机 NSIS 从 0.3.0 升级至 0.3.5 已完成，退出码为 0；注册表保留同一安装 GUID，DisplayVersion 为 0.3.5，EXE ProductVersion 为 0.3.5.0。

- 首次启动前逐项比较 14,908 个不可重建载荷文件，均与选定目录候选匹配。目录包执行冒烟测试会新增 Python bytecode，因此 666 个可重建 Python 缓存文件未参与安装器载荷比对；不能把测试后目录的所有文件均当作安装器的原始输入。
- 4,771 个原 `.local` 数据文件在安装完成、首次启动前仍与冷备份逐项散列一致。新增的 `services.dpapi` 是前述加密迁移结果，不覆盖原有文件。
- 实际安装版首次启动显示原创角色 B，DeepSeek 路由及 ASR/TTS 配置可用，`configurationRequired=false`，无活动任务或模型请求。没有要求用户重新填写密钥。
- 通过启动器既有可信父进程 IPC 请求有序退出，Electron 返回 0；没有强制结束日常程序。随后对关闭状态的 profile 做只读副本检查：18 个会话、活动会话 295 条消息，索引及归属正常，历史语音附件仍存在。此检查证明结构和附件保留，不等同于逐条阅读或逐条内容比对；原历史引用继续保留，并非迁移成新前缀。
- 再正常启动日常安装版，原创角色恢复，服务连接正常，仍无需配置，活动任务/模型请求为 0。没有在这套完整安装包上重复真人麦克风验收，不把此前局部补丁的语音验收写成这套新包的全链路真人结果。
- 选定最终目录包的 11 个受控场景通过（22 次本机模拟模型请求，真实云端调用 0）。恢复原生拖动实现后的 3 项浏览器名称过滤回归通过，其中两项为本次平台路径回归、一项为既有滚动条拖动用例，其余 30 项未在本轮运行。

| 交付物 | SHA256 |
| --- | --- |
| `Lingbo-Desk-0.3.5-Setup.exe` | `c1b2c8ecd0e0470521894ae435ad3231bde15b29299d50e15d3f72b947491ee9` |
| 已安装 `app.asar` | `96bac6a0dcfdb6bc79a999c5fbd709ed06f2cdb9bf1daabc14586c15e1898e49` |

记录：`selected-package-verification.json`、`before-upgrade-verification.json`、`installer-exit.json`、`installed-payload-verification.json`、`installed-first-start.json`、`installed-normal-exit.json`、`post-upgrade-structure.json`、`installed-restart-verification.json`。当前只完成本机升级，没有 Git 提交、远程推送或 GitHub Release；未验证全新 Windows 机器、升级回滚演练或卸载保留数据。本轮完成后暂停，不自动进入发布工作。

收尾时已重新构建最终原生拖动源码，清除构建工作区中的 CSS 试验产物，并对选定包与最终重建产物中的五个关键函数做 AST 打印比较：`handleStartDraggingWindow`、`parseChatAssetReference`、`readHistoricalChatAsset`、`chatAssetIdFrom`、`readChatAsset` 均一致（排除注释）；见 `current-build-consistency.json`。这不是整个程序包字节一致的声明。源码检查通过；差异格式检查按 Windows CRLF 规则通过。

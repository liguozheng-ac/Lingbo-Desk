# Windows 独立便携测试包

本地测试版本：`0.3.4-test`。当前长文档读取/修改与恢复专项见 [长文档与故障恢复](long-documents-and-recovery.md)；首次配置功能见 [首次配置与评测](service-onboarding-and-real-evaluation.md)，历史图标变更见 [图标及依赖更新](icon-and-dependency-update.md)。不安装、不替换正式版、不发布 GitHub。

## 使用方式

解压测试 ZIP 后运行 `LingboDesk.exe`，保持同目录的 `resources` 等文件完整。

测试版默认使用 `%LOCALAPPDATA%/LingboDesk-Test`；后端端口 `39850`，角色静态服务端口 `39851`。正常版本继续使用 `LingboDesk`、`3850` 和 `5173`。显式设置 `VOICE_AGENT_WORKSPACE`、`LINGBO_GATEWAY_PORT`、`LINGBO_RENDERER_PORT` 可以覆盖这些默认值；与其他服务冲突时停止启动，不结束其他程序。

首次启动缺少模型配置时会打开工作台；在“首次使用与服务配置”填写密钥，加密保存，再分别检查连接。仅用 Ollama 无需 DeepSeek 密钥，在“模型选择”验证并切换；语音仍需 ASR/TTS。

已有环境变量和配置文件仍兼容。例如测试数据目录的 `.local/.env`：

```dotenv
DEEPSEEK_API_KEY=
ALIYUN_ASR_API_KEY=
DOUBAO_TTS_API_KEY=
```

新提交的密钥用 Windows CurrentUser DPAPI 保存到 `.local/services.dpapi`，不在界面回显；旧 `.env` 仍是明文，未自动迁移或删除。新保存字段优先，明确清除会禁止回退该字段。DPAPI 不防护同一用户下其他进程。个人配置均不放入程序包或 Git。

角色窗口首次连接本机网关后，会补齐尚未配置的本机兼容提供商和默认选择，已有提供商地址不会覆盖。新角色配置的麦克风默认关闭，由用户手动开启。测试版包含本机已有的 Hiyori 资源；源码仓库仍不包含角色与 Cubism Core，需要使用者按各自许可提供。此本地资产组合未授权公开分发。

## 实际运行目录

```text
Lingbo-Desk-0.3.4-test-win-x64/
├─ LingboDesk.exe
├─ START-HERE.md
└─ resources/
   ├─ app.asar                    # 桌面编译产物和启动器
   ├─ app.asar.unpacked/          # 桌面原生依赖
   ├─ node-runtime/node.exe      # 网关/Agent 的独立 Node
   ├─ python/                    # 标准库及项目固定文档/解码依赖
   ├─ service/
   │  ├─ backend/
   │  ├─ runtime/
   │  ├─ engine/
   │  └─ speech/
   └─ package-manifest.json       # 版本、原生模块和关键源码哈希
```

`migration-source.json` 不再是启动依赖。没有从旧开发目录自动复制聊天、凭据或任务；已有同一数据目录中的用户数据仍由原服务读取。个人设置中的可选 profile 映射仍可使用，未宣称验证所有历史迁移情况。

## 构建输入与步骤

先按 `setup.md` 安装固定版本依赖、构建桌面工作区模块、准备本人取得许可的 Core/模型，再运行 `pnpm run build:desktop`。

打包需要显式准备：

| 输入 | 说明 |
| --- | --- |
| `LINGBO_BUILD_ROOT` | 已安装依赖并完成桌面构建的当前源码目录；默认仓库根目录 |
| `LINGBO_NODE_RUNTIME` | Windows x64 Node 24 的 `node.exe`；本次为 24.22.1 |
| `LINGBO_PYTHON_RUNTIME` | Python 3.12 Windows 运行时目录；本次为 3.12.14 |
| `LINGBO_PNPM_CLI` | pnpm 11.24.0 的 JS CLI 文件，用当前 Node 执行 |
| `LINGBO_ELECTRON_DIST` | 与桌面依赖一致的 Electron 43.8.4 Windows x64 解压目录 |
| `LINGBO_PACKAGE_OUTPUT` | 不存在的新输出目录，避免覆盖已有包 |
| `LINGBO_BUILDER_CLI` | 可选的 electron-builder 26.16.1 CLI；未设置时从桌面依赖解析 |
| `LINGBO_BUILD_PROXY` | 可选的依赖下载代理，不作为运行凭据装入包 |

```powershell
# 以上输入应指向使用者自己准备的运行时、工具与新输出目录。
pnpm run package:desktop
$testCandidate = Join-Path $env:LINGBO_PACKAGE_OUTPUT 'package/win-unpacked'
node scripts/verify-package.mjs "$testCandidate"
node scripts/smoke-windows-package.mjs "$testCandidate"
$testArchive = Join-Path (Split-Path -Parent $testCandidate) 'Lingbo-Desk-0.3.4-test-win-x64.zip'
python scripts/archive-windows-package.py "$testCandidate" "$testArchive"
```

`package-desktop.mjs` 按允许的源码目录装配服务，排除环境文件、用户数据和测试资料。后端生产依赖在包内重新生成 hoisted 布局，避免把 pnpm 的外部目录联接复制成无法解析间接依赖的普通文件。引擎从提交的 npm 锁导入；语音适配器按其固定直接依赖安装。结果中的 Node 依赖图及 Python 包版本会保留为构建记录。

Python 只从输入复制运行时/标准库，随后按 `requirements-windows.lock` 安装二进制轮子，不继承原机器的整个 site-packages。锁文件覆盖 Windows x64 / CPython 3.12 的全部 11 个直接、间接依赖，使用 `--require-hashes --only-binary=:all:`；打包前检查直接依赖与锁一致，打包后检查实际分发版本集合。锁文件及其 SHA256 一并留在包内。SQLite 使用同版本的本机已验证原生缓存，并用包内 Node 实际打开数据库校验 ABI。复用的原生缓存不是“本轮从 C++ 源码编译成功”的证据。

桌面模块使用现有已安装依赖缓存，electron-builder 依赖在工作区锁中已有记录。修正了桌面 app 的 `packageManager` 字段，避免直接启动 builder 时误判为 npm。产出 unsigned 的目录测试包，当前未生成 NSIS 安装器。

## 启动、退出与日志

`package-bootstrap.mjs` 用包内 Node 启动 `service/backend/server.mjs`，通过私有 IPC 请求有序停止。启动先检查两个端口，健康检查核对实际子进程 PID，避免误接其他服务。窗口 profile 位于所选数据目录，测试版与正式版隔离。

退出时先中止后台工作、等待进程关闭，再关闭静态服务，并检查后端退出码。事件流先停止发布和心跳，再结束连接，避免最终任务状态向已结束响应写入导致后端崩溃。启动器与网关使用相同的限额元数据日志规则，但分开日志组，避免进程内的活动标记造成跨进程误清理；不再生成新的原始 `packaged-backend.log`/`packaged-launcher.log`。清理超时时仍有进程树终止兜底；这不是通用系统沙箱，也不保证任意脱离的脚本后代都被清理。

首次启动的连接凭据通过静态服务的同源端点转接，不放入 HTML，也不放宽后端 `/bootstrap` 原有的跨站读取限制。角色端主动初始化所需的懒加载 stores，再注册工作工具和建立事件连接。

## 0.3.1-test 历史验证与证据边界

- 后端 **91/91** 项自动化测试通过；最终原生程序 **11/11** 个受控验收场景通过。这些数字不是实际模型任务成功率。
- 桌面正式构建成功；补齐个人已取得的 Hiyori 资源后重新构建。
- 从新输出目录完整执行打包 CLI 成功；包内 SQLite、Python 文档库和 `av` 均通过运行检查。
- 新包移到另一目录后，用全新临时数据目录与独立端口运行；模型通过本机 Ollama 兼容测试服务模拟，不使用真实云端模型或用户账户。
- 实际创建文本、生成并重新读取 DOCX、暂停/修改/恢复、取消、生成报告检查点、合成音频解码，以及仍有后台任务时退出均纳入测试。
- 原生 Hiyori 窗口实际显示，观察到麦克风为关闭状态；实时人工语音和完整前台语音任务闭环未在本轮重新验收。
- 包检查核对关键源码/运行时/原生模块哈希，检查链接、个人配置文件和已知凭据形态。它不是能识别所有秘密的扫描器。
- ZIP 仅收集已验收程序目录，不收集旁边的模拟配置、数据目录或构建载荷，并复核 CRC。
- 已安装程序的 EXE/ASAR及选定个人配置文件通过前后哈希/时间戳核对；没有更新安装版或发布远程仓库。

完整日志、截图观察说明、扫描结果、版本/哈希与模拟场景结果保存在本机审计记录。此前 `test-action-contract.js` 的既有“大浏览器”分类断言失败仍未修复，不应把本轮后端测试通过理解为整个仓库所有测试均通过。

本轮实际排障包括：复制 pnpm 联接后丢失间接依赖，改为包内 hoisted 安装；builder 误判包管理器，补齐 app 元数据；新配置下桥接未建立，改为主动初始化 stores 与同源凭据转接；接通事件流后退出时后端返回 1、状态停在 `pause_requested`，改为先停止事件发布再结束连接，并校验后端退出码。最终退出测试同时确认 Electron 返回 0、后端已退出、任务落盘为 `paused`、测试端口释放。全文 stderr 没有作为常规诊断保存，未把未保存的异常栈列作证据。

完整打包 CLI 曾从新目录成功装配；之后的桥接和退出修复复用了已验过 ABI/依赖的 Node/Python 载荷，重新构建桌面与应用包，并再次搬迁目录验收。最终 ASAR 中 4 个启动器文件与当前源码逐字节匹配，关键服务文件及原生模块校验通过；未用“复用了本机缓存”代替全新机器构建证据。

这次证明的是**本机现有工具/原生缓存条件下可装配并运行独立测试包**。尚未证明全新 Windows 机器冷启动构建、字节一致可复现、安装升级/回滚/卸载、代码签名、全量第三方操作或长期稳定性。`0.3.1-test` 当时尚未固定全部 Python 间接依赖；`0.3.2-test` 补齐了版本及轮子哈希，但这仍不等于整个程序包字节一致可复现。

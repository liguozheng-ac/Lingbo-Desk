# 环境与启动

## 环境

- Windows x64。
- Node.js 24，pnpm 11。桌面工作区在 `packageManager` 中固定 pnpm 版本。
- Python 3.12。建议使用项目根目录的 `.venv`。
- 文件与浏览器工作需要本机 Edge。部分 Node 原生模块需要兼容的预编译包或本机 C++ 构建环境。

## 安装依赖

在仓库根目录运行 README 中的三个 pnpm 安装命令，然后创建 Python 虚拟环境并安装 `requirements.txt`。

Windows x64 / CPython 3.12 若要使用便携包验证过的完整版本集合，可改用 `python -m pip install --require-hashes --only-binary=:all: -r requirements-windows.lock`。便携打包脚本强制使用该锁；其他平台需要各自生成适用的轮子锁。

引擎使用 `better-sqlite3`。如果包管理器提示跳过原生构建，检查该模块的安装脚本后，在引擎目录为该模块启用并重新运行构建。不要把另一台机器的原生二进制提交进仓库。

```powershell
pnpm --dir engine rebuild better-sqlite3
```

预编译包下载失败时需要可用的 Windows C++ 构建工具；详见 [本次验收边界](verification.md)。

## 服务配置

后端无需密钥即可启动。Windows 用户打开工作台的“首次使用与服务配置”，填写所需 DeepSeek、阿里云 ASR 与豆包 TTS 密钥，点击“加密保存到本机”，再分别检查连接。新配置保存在个人数据目录的 `.local/services.dpapi`，使用 Windows CurrentUser DPAPI 加密，界面不回显密钥。

仅使用 Ollama 时无需 DeepSeek 密钥；先在“模型选择”验证并切换到本地模型。语音仍需独立配置 ASR/TTS。连接检查会使用正常 API 用量，不等于任务或语音准确率验收。

也可复制 `.env.example` 为 `.env` 使用环境变量配置。旧配置继续兼容，不会自动迁移或删除；界面新保存的字段优先，明确清除会禁止该字段回退到旧配置。后端不依赖任何代码助手的私有凭据目录。

语音的高级配置可通过 `LINGBO_SPEECH_CONFIG` 指向个人 JSON 文件。格式如下，示例不含有效凭据：

```json
{
  "asr": { "aliyunApiKey": "" },
  "tts": { "provider": "doubao", "keys": { "doubaoKey": "" } }
}
```

配置文件应放在 Git 之外。不要把填写后的 `.env`、配置文件或网关连接凭据上传。

## 启动后端

`pnpm start` 启动本机服务。工作台地址为 `http://127.0.0.1:3850`。
默认运行数据保存在根目录 `.local/workspace`，可通过 `VOICE_AGENT_WORKSPACE` 指向其他个人目录。

如果系统中有多个 Python，通过 `VOICE_PYTHON` 指向对应虚拟环境的 Python。

`node --test backend/test/*.test.mjs` 包含实际启动网关的配置集成测试，需要先安装引擎和语音依赖；文档/音频检查还需要具备相应模块的 Python。最新验证与真实服务评测见 [首次配置与评测记录](service-onboarding-and-real-evaluation.md)。

长文档范围读取、DOCX 精确修改和任务恢复的后续验证见 [长文档与恢复专项](long-documents-and-recovery.md)。

## 准备桌面

从官方渠道取得 Cubism SDK，自行阅读并接受其条款。设置 `LIVE2D_CORE_PATH` 指向本机 `live2dcubismcore.min.js`。

按顺序运行：

1. `pnpm --dir desktop run build:modules`
2. `pnpm run prepare:desktop`
3. `pnpm run build:desktop`

准备脚本将本机 Core 复制到已忽略的生成目录，不会将它纳入源码提交。默认关闭构建时的 SDK、角色模型和离线语音模型下载。

角色模型由用户按许可自行导入。可在角色设置界面导入模型，或使用 `LINGBO_MODEL_ASSETS` 指向如下个人目录后重新准备桌面：

```text
your-assets/
├─ live2d/     模型 ZIP 和相应预览目录
└─ vrm/        可选 VRM 模型目录
```

不导入模型时可以验证源码构建，但内置角色预设的资源不可用。

## 桌面连接后端

开发时先启动后端，再运行 `pnpm run dev:desktop`。首次使用在桌面设置中选择 OpenAI-compatible 提供商，使用本机 `/v1/` 地址和本机连接凭据；模型名称为 `voice-agent-default`。
识别和合成分别使用相应的 OpenAI-compatible 音频提供商，模型名称为 `local-paraformer`、`local-doubao-tts`。

本机网关连接凭据由后端首次启动生成，保存在运行目录 `.local/gateway-token`。它不是云服务 API Key，仅在本人本机配置中使用。

可按[Windows 独立测试包](windows-test-package.md)装配本地便携测试版。测试版默认使用单独的数据目录和端口；不读取旧开发目录的迁移输入，不包含个人凭据。正式安装器、自动升级和跨版本数据迁移仍需单独验收。

测试包的使用、构建输入和实际验证边界见上述说明。不要将填有凭据的个人环境文件提交到仓库。

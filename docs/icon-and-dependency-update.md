# 0.3.2-test：应用图标与 Windows 依赖锁

## 范围

使用用户提供的粉色人物图片替换 Windows 程序、窗口和托盘图标；锁定 Python 运行依赖；重新生成独立便携测试包。保留 Hiyori 角色及现有语音配置。没有修改安装版、启用自启动或上传 GitHub。

## 图标实现

- `scripts/prepare-app-icons.py` 用 Pillow 做等比例缩放、白色正方形留边和格式编码，不重绘或裁切人物。原图片较小，512 像素编码不代表增加了原始细节。
- `desktop/apps/stage-tamagotchi/resources/icon.png` 与 `icon-512.png` 为 512×512 PNG；`icon.ico` 包含 16/24/32/48/64/128/256 像素帧。
- 现有窗口与 Windows 托盘均从 `icon.png?asset` 引用图标，托盘仍缩为 16 像素。桌面需要重新构建才能更新这些导入资源。
- `scripts/package-desktop.config.cjs` 为 Windows 指定 `resources/icon.ico`，启用 EXE 资源编辑，保留 `signExecutable: false`。启用资源编辑不会将此测试包变成已签名程序。
- `scripts/verify-windows-icon.py` 以数据资源模式读取 PE 的图标组和各帧，逐一比较源 ICO 的 SHA256，不执行被检查的 EXE。

重新编码本人提供的图标：

```powershell
python scripts/prepare-app-icons.py 'D:\your-assets\app-icon.png'
```

Windows 资源管理器可能继续缓存旧路径图标。本轮使用新的测试包目录；不清理用户系统图标缓存、不替换已固定到任务栏的旧安装版快捷方式。

## 依赖锁实现

`requirements.txt` 继续表达跨平台的直接依赖；新增 `requirements-windows.lock` 用于 Windows x64 / CPython 3.12 便携包，覆盖全部 11 个运行分发包并记录选定轮子的 SHA256。初始版本集合来自上版已验收包；轮子通过公开 PyPI 下载后计算哈希。

`scripts/package-payload.mjs` 调用 `readPythonLock()` 检查直接版本一致，再用 pip `--require-hashes --only-binary=:all:` 安装完整依赖闭包。Pip 负责验证下载文件哈希以及依赖版本约束；包内 Python 实际导入文档与音频模块，并检查真实安装分发集合与锁完全一致。`scripts/verify-package.mjs` 再次核对锁文件哈希及实际分发集合。

改变依赖时需要同时更新直接声明、Windows 锁、对应轮子哈希并重新验证。其他平台、Python 次版本需要独立锁，不能直接复用这里的单平台轮子哈希。固定版本减少依赖解析漂移，不替代安全审计，也不证明整个构建逐字节一致。

## 验证记录

本轮日志位于本机审计目录 `Lingbo-Desk-Audit/2026-11-04/icon-package`。验收结果完成后记录在下方；模拟模型结果与真实模型能力分开解释。

- 桌面构建成功；后端自动化测试 **93/93** 通过。
- 有意将本地公开轮子的预期 SHA256 改为无效值，pip 返回错误并明确拒绝哈希不符文件。
- EXE 的 7 档图标帧与源 ICO 逐一相同；ASAR 中 PNG/ICO、编译后主进程引用的图标资源与源码一致。窗口与托盘共享该 PNG 导入；未逐个手动打开所有辅助窗口。
- 完整打包命令从新输出目录执行成功；搬到最终测试目录后，原生程序 **11/11** 项受控验收通过：新数据启动、角色桥接、模型选择、真实文本与 DOCX 产物、暂停/修改/恢复、取消、报告检查点、音频解码、带运行中任务退出及日志内容检查。
- 模型为本机确定性 Ollama 兼容测试服务，共 22 次模拟模型请求、0 次真实云模型调用。没有重新测试人工实时语音、安装升级或全新 Windows 机器。
- 11 个 Python 分发版本与锁完全一致；包检查通过，未发现文件链接、禁止的个人配置文件或已知凭据模式。模式检查不等于能识别所有秘密。
- 原安装版 EXE/ASAR 与选定个人配置的前后哈希及修改时间一致。旧包保留，新包不覆盖旧包。ZIP 的最终 CRC 与 SHA256 见本机 `archive.log`、`final-verification.json`。

完整使用方式及构建输入见 [Windows 测试包说明](windows-test-package.md)。

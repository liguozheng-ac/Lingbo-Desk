# Changelog / 版本更新

## 0.3.5 — 2026-11-12

### 简体中文

- 接入原创 Live2D 角色 B 的运行素材与预览，支持眨眼和基础语音嘴型，保留既有角色选择。
- 兼容历史语音附件引用，修复旧会话加载失败阻塞语音发送的问题。
- 本地版本默认关闭未配置的账号登录服务，防止重复唤起浏览器；补充请求去重及本机授权导航保护。
- 修复 Windows 拖动控件将异步系统探测误当布尔值的问题。
- 统一源码和打包版本，支持目录包及 NSIS；完成本机安装升级和正常退出重启验证。
- 真实 DeepSeek 的 4 个受控任务覆盖文件整理、DOCX 精确修改、暂停/修改/恢复、取消及独立浏览器读取，共 7 项检查通过。真人反馈确认连续对话、基础嘴型、打断、旧播报不重现及无需重开麦克风。

### English

- Added original Live2D Character B runtime assets and preview, with blinking and basic speech-driven mouth movement; existing character selection is preserved.
- Recognized historical audio attachment references to prevent session-loading failures from blocking voice submissions.
- Disabled unconfigured account login in the local build, deduplicated pending login requests, and guarded local authorization navigation to prevent browser-launch loops.
- Fixed the Windows drag control's asynchronous platform check.
- Aligned source and packaging versions, supported directory and NSIS builds, and verified a local upgrade and graceful restarts.
- Four controlled tasks with the real DeepSeek API covered file summaries, precise DOCX editing, pause/change/resume, cancellation, and independent browser reading, with seven checks passing. User feedback confirmed continuous conversation, basic lip sync, interruption, no stale playback recurrence, and no need to reopen the microphone.

### Scope / 验证边界

Source update only; no public installer or GitHub Release. The local package is unsigned and includes separately licensed local assets. The task cases are small samples, not general success-rate statistics. Fresh-machine installation, long-term stability, acoustic latency, and simultaneous voice/task experience remain outside this acceptance scope.

本次仅同步源码，不公开安装包或创建 GitHub Release。本机安装包未签名并含单独许可的本地素材；测试小样本不代表通用任务成功率。全新机器安装、长期稳定性、声学延迟及语音与任务同时进行时的体验仍需继续验证。

[Build and upgrade record / 安装升级记录](docs/release-0.3.5.md) · [Acceptance record / 验收记录](docs/acceptance-0.3.5.md)

# CodeLens Pro Next

CodeLens Pro Next 是 CodeLens Pro 的本地独立重写版，面向真实个人开发、项目审查、学习沉淀和确认式行动草稿。

## 架构

- 桌面端：Tauri
- 前端：React
- 核心逻辑：Rust
- 数据：本地 SQLite
- LLM：可选，支持 OpenAI-compatible `chat/completions` stream
- 兜底：无 API Key 或 LLM 失败时使用本地规则分析
- 日志：`logs/codelens-next.log`

## 主线能力

- 多文件项目分析
- 项目工作区管理
- 项目导览
- 代码地图
- 问题清单
- 报告阅读器
- 历史报告
- 代码对比
- AI 对话
- 行动草稿，支持预览、确认、备份和结果追踪
- 知识卡片
- 每日学习中心
- 活动星图
- 设置与模型管理
- 本地数据统计

## 关键路径

- 源码：`exe-prototype/rewrite`
- 构建缓存：`exe-prototype/.cache`
- 输出目录：`exe-prototype/outputs/codelens-next`
- 可执行文件：`exe-prototype/outputs/codelens-next/CodeLens Pro Next.exe`

## 构建

从项目根目录运行：

```powershell
.\exe-prototype\rewrite\scripts\Build-CodelensNext.ps1 -MinFreeMemoryGB 2
```

构建脚本会先检查 CPU 和内存；电脑负载过高时会提前停止。

### v1.1.0 发布通道

未签名候选版使用明确的 RC 通道：

```powershell
.\exe-prototype\rewrite\scripts\Build-CodelensNext.ps1 -ReleaseChannel rc3 -MinFreeMemoryGB 2
```

正式版不允许未签名构建。代码签名证书必须安装在当前用户证书存储区，并通过指纹显式选择：

```powershell
.\exe-prototype\rewrite\scripts\Build-CodelensNext.ps1 `
  -ReleaseChannel stable `
  -CertificateThumbprint <thumbprint> `
  -MinFreeMemoryGB 2
```

稳定版门禁会执行完整审计、真实工作区闭环和当前用户安装验收。安装验收会修改当前用户安装注册项，因此必须显式确认；检测到已有安装版时会拒绝继续：

```powershell
.\exe-prototype\rewrite\scripts\Invoke-StableReleaseGate.ps1 `
  -ExpectedChannel rc3 `
  -ConfirmCurrentUserMutation `
  -MaxCpuPercent 100 `
  -MinFreeMemoryGB 2
```

正式版还必须传入证书指纹，并确认交互式桌面快捷方式与真实模型冒烟已经人工完成。私有备份只写入 `.cache`，共享审计报告不会记录 API Key、源码、提示词或模型响应。

## v1.0 验收

从项目根目录运行：

```powershell
.\exe-prototype\rewrite\scripts\Audit-CodelensNext.ps1 -MinFreeMemoryGB 2
```

验收脚本会检查版本一致性、原项目隔离、前端构建、前端视觉冒烟、Rust 测试、Tauri 检查、release 输出和启动/关闭烟测。

## 持续集成

桌面源码使用两层 Windows 质量门禁：

- `.github/workflows/desktop-ci.yml`：PR 与 `master` 推送触发。使用 Node.js 22、Rust stable 和锁文件依赖，执行正式/预览构建、生产入口隔离、字号审计、Rust 测试、Tauri 检查，以及深浅主题下 16 组快速交互烟测。该工作流不构建 EXE。
- `.github/workflows/desktop-release-audit.yml`：仅手动触发。执行完整路由矩阵、视觉烟测、真实项目闭环验收和 Release 构建，并上传候选 EXE、全路由截图与最小审计证据 14 天。工作流不会创建标签或 GitHub Release。

本机复现快速门禁前，分别在 `web` 与 `desktop` 目录执行 `npm ci`，再运行：

```powershell
.\exe-prototype\rewrite\scripts\Audit-CodelensNext.ps1 `
  -SkipReleaseBuild -SkipVisualSmoke -SkipInteractionSmoke -SkipLaunchSmoke `
  -MaxCpuPercent 100 -MinFreeMemoryGB 0.5

.\exe-prototype\rewrite\scripts\Test-FrontendInteractionSmoke.ps1 `
  -Quick -OutputDir .\exe-prototype\outputs\codelens-next\quick-interaction
```

## 真实项目闭环验收

真实验收固定扫描 `exe-prototype/rewrite` 自身源码，并强制使用本地规则模式。它覆盖工作区导入、代码地图、项目导览、项目报告、问题、卡片、学习材料、每日日志、关闭重开持久化，以及产品档案导出/导入。

```powershell
.\exe-prototype\rewrite\scripts\Test-RealWorkspaceAcceptance.ps1
```

测试通过后，Markdown、JSON 与日志写入 `exe-prototype/outputs/codelens-next/v14.16-acceptance`。SQLite 数据库位于独立临时目录，不读取或修改用户现有数据；成功后默认清理，失败时保留诊断目录。需要保留成功产物时使用 `-KeepArtifacts`。

测试专用环境变量：

- `CODELENS_ACCEPTANCE_WORKSPACE`：待扫描的真实项目目录。
- `CODELENS_ACCEPTANCE_OUTPUT`：集成测试 JSON 输出路径。
- `CODELENS_TEST_ROOT`：隔离的应用根目录和 SQLite 数据目录。

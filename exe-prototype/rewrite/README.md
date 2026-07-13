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

## v1.0 验收

从项目根目录运行：

```powershell
.\exe-prototype\rewrite\scripts\Audit-CodelensNext.ps1 -MinFreeMemoryGB 2
```

验收脚本会检查版本一致性、原项目隔离、前端构建、前端视觉冒烟、Rust 测试、Tauri 检查、release 输出和启动/关闭烟测。

# CodeLens Pro

CodeLens Pro 是一个本地运行的编程学习与智能代码分析工作台，采用 **FastAPI + React + MySQL + DeepSeek API + VS Code 插件**。当前版本已经不只是“生成代码分析报告”的 Demo，而是包含报告阅读、AI 对话、Agent 项目协作、知识卡片、每日日志、统计分析和活动星图的一套本地准产品原型，适合课堂展示、课程设计、毕业设计演示和个人学习复盘。

> 本 README 说明当前 Web 应用、FastAPI 后端和 VS Code 插件协同版本，不展开旧版 Streamlit 实现。

## 功能概览

- **代码工作台**：分析主线起点。粘贴代码或接收 VS Code 插件传入的当前文件/选中代码，执行静态分析，生成 SSE 流式 AI 报告。
- **代码对比**：分析主线的变体入口。对两个版本代码生成差异分析、风险提示、性能对比和改进建议。
- **报告阅读器**：分析主线的阅读层。支持全屏阅读、PyCharm 风格代码块、复制代码、报告上下文追问和多轮对话定位。
- **AI 对话**：复盘辅助入口。普通聊天独立保存，支持历史会话搜索、继续对话和上下文无关的编程问答。
- **Agent 工作区**：协作主线入口。通过 VS Code 插件同步当前项目、项目树和心跳状态；支持手动选择文件、AI 自动选择上下文、混合补充上下文，并生成可确认/执行的修改计划。
- **项目导读**：协作主线的辅助视角。基于 VS Code 插件同步的项目结构生成导读建议，帮助快速理解项目目录、入口和可能涉及的知识点。
- **知识卡片**：学习沉淀主线。从报告、对话或手动输入沉淀知识点；支持详情页、学习资料生成、代码摘录、外部资源、状态管理和个人笔记。
- **每日日志**：学习闭环收尾。汇总当天报告、AI 对话、知识卡片、Agent 使用情况，调用 LLM 生成日志；无使用记录的日期也可以手写日记。
- **历史报告**：分析主线的回流入口。报告自动命名、搜索、筛选、查看详情、删除，并可回到工作台或代码对比页面继续使用。
- **统计看板**：复盘展示层。展示 API 余额、Token、报告数、会话数、最近活动和功能使用情况。
- **活动星图**：复盘展示层。从统计页进入全屏 3D 星图，每颗主星代表报告、聊天或 Agent 活动，支持拖拽旋转、滚轮缩放和点击查看详情。
- **本地持久化**：报告、静态指标、聊天会话、Agent 计划、学习卡片、每日工作日志等保存到本机 MySQL。

## 当前产品边界

- Web 端不会直接读取本地项目文件内容；项目结构和文件内容读取由 VS Code 插件完成。
- 项目树心跳只上传文件/目录元信息，不上传代码内容。
- Agent 的 `手动选择 / AI 自动选择 / 手动 + AI 补充` 都以工作区相对路径为边界，插件端会再次校验路径，避免越出 workspace root。
- 知识卡片“学习资料”由 LLM 基于卡片信息和白名单资源生成并缓存，不直接抓取或复制网页正文。
- 每日日志使用本地数据库中的当天活动生成；空白日期的手写日记不依赖 LLM。
- 活动星图展示最近活动数据和代码行数派生的背景星尘，用于课堂展示和沉浸式回顾，不替代统计报表。

## 业务流程

1. 用户在 Web 工作台粘贴代码，或在 VS Code 插件中选择当前文件、选中代码、项目文件或自动项目上下文。
2. 前端提交代码到后端，后端先执行静态分析，返回行数、函数数量和安全风险等基础指标。
3. 用户生成报告后，后端根据代码、语言、分析模式和上下文组装 Prompt，调用 DeepSeek API，并通过 SSE 流式返回报告。
4. 报告、静态指标和关联聊天会话会保存到 MySQL，用户可在历史报告中检索并恢复上下文。
5. 用户可以在报告下方继续追问；普通 AI 对话则不默认携带代码或报告，适合自由学习问答。
6. Agent 工作区从 VS Code 插件读取当前项目状态。用户可勾选项目树文件，也可让 AI 根据任务和文件清单自动选择上下文。
7. 后端生成 Agent 计划后，插件端读取选中文件内容、执行或回传结果，Web 端展示计划、状态、上下文文件 chips 和执行结果。
8. 用户可将重要知识沉淀为知识卡片，生成学习资料、记录笔记并标记复习状态。
9. 每日日志按日期汇总报告、对话、Agent 和知识卡片活动；有活动可生成日志，无活动也可作为个人日记本手写保存。
10. 统计页汇总使用数据，并可进入活动星图查看报告、聊天和 Agent 活动的空间化呈现。

## 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind CSS、Monaco Editor、react-markdown、Radix UI、framer-motion、Recharts、Three.js、lucide-react
- 后端：FastAPI、SQLModel、SQLAlchemy、Alembic、PyMySQL
- 数据库：MySQL 8
- VS Code 插件：TypeScript、VS Code Extension API、Webview、WorkspaceEdit
- AI：DeepSeek API，OpenAI SDK 兼容调用
- 流式输出：SSE
- Token 统计：本地 DeepSeek V3 tokenizer
- 本地启动：`start.bat` / `start.ps1`
- 容器化：Docker Compose、Nginx、MySQL 8

## 环境要求

### 本地开发模式

- Windows + PowerShell
- Python 3.12+（运行 `python --version` 确认）
- Node.js 18+（运行 `node --version` 确认）
- 本机 MySQL 8（如果没有，先安装 [MySQL 8 Community Server](https://dev.mysql.com/downloads/mysql/)），默认服务名建议为 `MySQL80`

### Docker 模式

- Docker Desktop
- Docker Compose
- 可访问 Docker Hub 拉取基础镜像

## 环境变量

复制示例配置：

```powershell
copy .env.example .env
```

本地开发模式常用配置：

```env
DATABASE_URL=mysql+pymysql://root:你的MySQL密码@127.0.0.1:3306/codelens_demo?charset=utf8mb4
DEEPSEEK_API_KEY=你的DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-flash
DEEPSEEK_DEFAULT_MODEL_LABEL=DeepSeek-V4-Flash
CODELENS_DEFAULT_LANGUAGE=Python
```

Docker 模式可以复制：

```powershell
copy .env.docker.example .env
```

Docker 模式不需要手写 `DATABASE_URL`，Compose 会自动为后端生成容器内部数据库地址。

## 本地启动

推荐课堂展示使用本地启动方式，稳定、启动快、便于调试。

```powershell
.\start.bat
```

启动后访问：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`
- 健康检查：`http://127.0.0.1:8000/api/health`

`start.ps1` 会自动完成：

1. 检查 `.env`，不存在则从 `.env.example` 创建。
2. 尝试启动本机 `MySQL80` 服务。
3. 创建 Python 虚拟环境。
4. 安装后端依赖。
5. 安装前端依赖。
6. 启动 FastAPI 与 Vite。
7. 打开浏览器访问前端页面。

### 手动分步启动（脚本失败时兜底）

如果 `start.bat` 执行出错，可以按以下步骤手动启动：

```powershell
# 1. 确认环境
python --version
node --version

# 2. 配置环境变量
copy .env.example .env
# 编辑 .env，填写 MySQL 密码和 DEEPSEEK_API_KEY

# 3. 安装后端依赖
pip install -r requirements.txt

# 4. 启动后端（新开一个终端）
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000

# 5. 安装前端依赖（新开一个终端）
cd frontend
npm install

# 6. 启动前端
npm run dev
```

### 验证是否成功

启动后按以下顺序确认：

1. 浏览器打开 `http://127.0.0.1:5173`，应看到 CodeLens Pro 界面
2. 顶部状态栏：MySQL 灯为绿色（如为红色表示数据库连接失败）
3. 进入代码工作台，点击"静态分析"按钮，指标面板应显示行数和函数数
4. 可选：填入 DEEPSEEK_API_KEY 后，可测试 AI 报告生成

## Docker 启动

Docker 模式用于后续提交、复现和部署，不建议课堂现场首次演示时依赖它。

1. 准备配置：

```powershell
copy .env.docker.example .env
```

2. 填写 `.env` 中的 `DEEPSEEK_API_KEY`。

3. 构建并启动：

```powershell
docker compose up --build
```

如果 Windows + Docker Desktop 环境在构建阶段出现 BuildKit/grpc 相关报错，可以先切换为传统构建器再启动：

```powershell
$env:DOCKER_BUILDKIT="0"
$env:COMPOSE_DOCKER_CLI_BUILD="0"
docker compose build
docker compose up -d
```

4. 访问：

- 前端：`http://127.0.0.1:15173`
- 后端：`http://127.0.0.1:18000`
- MySQL：`127.0.0.1:13307`

5. 停止：

```powershell
docker compose down
```

6. 删除 Docker MySQL 数据卷：

```powershell
docker compose down -v
```

## Docker 端口说明

Docker 默认端口避开本地开发端口：

| 服务 | 容器内端口 | 主机端口 |
| --- | --- | --- |
| frontend | 80 | 15173 |
| backend | 8000 | 18000 |
| mysql | 3306 | 13307 |

可以在 `.env` 中修改：

```env
FRONTEND_PORT=15173
BACKEND_PORT=18000
MYSQL_PORT=13307
```

## 常用命令

后端测试：

```powershell
python -m pytest backend\tests -q
```

后端语法编译检查：

```powershell
python -m compileall -q backend
```

前端构建：

```powershell
cd frontend
npm run build
```

Docker 配置检查：

```powershell
docker compose config
```

## API 概览

- `GET /api/health`：后端、MySQL、LLM Key 状态。
- `GET /api/settings`：语言、模型、分析模式和配置状态。
- `GET /api/ui/bootstrap`：前端启动所需的设置与统计摘要。
- `GET /api/activity/recent`：最近活动列表。
- `GET /api/activity/constellation`：活动星图数据。
- `GET /api/analytics`：使用统计、Token 统计、余额分析。
- `POST /api/analyze/static`：静态代码分析。
- `POST /api/reports/stream`：单段代码 AI 报告，SSE 流式返回。
- `POST /api/diff/stream`：双版本代码对比报告，SSE 流式返回。
- `POST /api/chat/stream`：AI 对话，SSE 流式返回并保存。
- `GET /api/agent/workspace/current`：读取 VS Code 插件最近一次工作区心跳。
- `POST /api/agent/workspace/heartbeat`：VS Code 插件上报当前项目名称、根目录、项目树和连接状态。
- `POST /api/agent/context/select`：根据任务描述和项目文件清单，让 LLM 选择 Agent 上下文文件。
- `POST /api/agent/plan`：生成 Agent 计划。
- `POST /api/agent/chat/stream`：Agent 对话，SSE 流式返回。
- `GET /api/agent/pending`：插件端拉取待处理 Agent 计划。
- `GET /api/agent/confirmed`：插件端拉取已确认可执行计划。
- `POST /api/agent/plans/{plan_id}/confirm`：Web 端确认 Agent 计划。
- `POST /api/agent/plans/{plan_id}/apply-result`：插件端回传执行结果。
- `GET /api/learning/cards`：知识卡片列表。
- `POST /api/learning/cards`：创建知识卡片。
- `PATCH /api/learning/cards/{card_id}`：更新知识卡片、状态和笔记。
- `DELETE /api/learning/cards/{card_id}`：删除知识卡片。
- `POST /api/learning/cards/generate`：从报告/对话等上下文生成知识卡片。
- `GET /api/learning/cards/{card_id}/material`：读取知识卡片学习资料。
- `POST /api/learning/cards/{card_id}/material/generate`：调用 LLM 生成并缓存学习资料。
- `GET /api/learning/project-guide`：读取项目导读数据。
- `GET /api/daily-logs/calendar`：读取每日日志日期索引。
- `GET /api/daily-logs/{date}`：读取指定日期日志。
- `POST /api/daily-logs/{date}/generate`：基于当天活动生成日志。
- `PATCH /api/daily-logs/{date}`：更新或手写创建指定日期日志。
- `GET /api/reports`：历史报告列表。
- `GET /api/reports/{id}/outline`：历史报告标题目录。
- `GET /api/reports/{id}`：历史报告详情。
- `DELETE /api/reports/{id}`：删除报告。
- `GET /api/chat/sessions`：聊天会话列表。
- `GET /api/chat/sessions/{id}`：聊天会话详情。
- `DELETE /api/chat/sessions/{id}`：删除聊天会话。

## 数据库迁移

项目使用 Alembic 管理表结构。启动脚本和后端初始化会尽量保证迁移被执行；手动维护时可使用：

```powershell
alembic upgrade head
```

当前迁移覆盖的主要数据域：

- `reports` / `analysis_metrics`：报告与静态分析指标。
- `chat_sessions` / `chat_messages`：普通对话、报告追问和 Agent 对话。
- `agent_plans`：Agent 计划、选中文件、上下文模式和执行结果。
- `learning_cards` / `learning_card_materials`：知识卡片、学习资料、笔记和复习状态。
- `daily_work_logs`：每日工作日志和手写日记。

## 项目结构

```text
机器学习课堂展示/
├── backend/                     # FastAPI 后端
│   ├── Dockerfile               # 后端容器镜像
│   ├── alembic/                 # 数据库迁移
│   │   └── versions/            # 0001-0009：报告、聊天、Agent、知识卡片、每日日志等迁移
│   ├── app/
│   │   ├── main.py              # FastAPI 实例、CORS、启动初始化
│   │   ├── config.py            # .env 配置读取
│   │   ├── db.py                # MySQL 初始化、迁移、Session
│   │   ├── models.py            # SQLModel 表模型
│   │   ├── schemas.py           # Pydantic 请求/响应模型
│   │   ├── api/
│   │   │   └── routes.py        # API 路由、SSE、报告/聊天/Agent/学习/统计逻辑
│   │   ├── services/
│   │   │   ├── analyzer_service.py  # 静态分析：行数/函数/密钥风险
│   │   │   ├── llm_service.py       # DeepSeek 调用、报告/聊天/Agent/学习资料/日志
│   │   │   ├── prompt_service.py    # 语言、模型、Prompt 模板适配
│   │   │   ├── sse.py               # SSE 事件格式化
│   │   │   └── usage_service.py     # 余额查询、Token 统计
│   │   └── resources/
│   │       └── deepseek_v3_tokenizer/ # 本地 tokenizer
│   └── tests/
│       ├── test_analyzer_service.py # 静态分析测试
│       └── test_ui_support.py       # UI 支撑接口、学习/Agent/日志测试
├── frontend/                    # React 前端
│   ├── Dockerfile               # 前端构建 + Nginx 镜像
│   ├── nginx.conf               # 静态托管与 /api 反向代理
│   ├── package.json             # 前端依赖与脚本
│   ├── vite.config.ts           # Vite 配置与本地开发代理
│   └── src/
│       ├── main.tsx             # React 入口
│       ├── App.tsx              # 页面路由状态、全局 settings/analytics
│       ├── types.ts             # 前端类型定义
│       ├── lib/
│       │   ├── api.ts           # REST API 封装
│       │   ├── stream.ts        # SSE 流式请求解析
│       │   └── format.ts        # 时间、模式格式化
│       ├── pages/
│       │   ├── WorkbenchPage.tsx       # 代码工作台
│       │   ├── DiffPage.tsx            # 代码对比
│       │   ├── ChatPage.tsx            # AI 对话
│       │   ├── AgentPage.tsx           # Agent 工作区、项目树、上下文模式
│       │   ├── ProjectGuidePage.tsx    # 项目导读
│       │   ├── KnowledgeCardsPage.tsx  # 知识卡片与全屏学习页
│       │   ├── LearningCenterPage.tsx  # 每日日志 / 手写日记
│       │   ├── ActivityGalaxyPage.tsx  # 全屏 3D 活动星图
│       │   ├── HistoryPage.tsx         # 历史报告
│       │   └── SettingsPage.tsx        # 统计看板
│       ├── components/
│       │   ├── AppShell.tsx       # 应用外壳
│       │   ├── Sidebar.tsx        # 左侧主导航
│       │   ├── TopBar.tsx         # 顶部状态栏
│       │   ├── WorkspaceSplit.tsx # 工作区拖拽分栏
│       │   ├── EditorPanel.tsx    # Monaco 编辑器
│       │   ├── ReportViewer.tsx   # 报告阅读、全屏、上下文聊天
│       │   ├── MarkdownDocument.tsx # Markdown/代码块渲染与复制
│       │   ├── ChatPanel.tsx      # AI 聊天窗口
│       │   ├── MetricsPanel.tsx   # 静态指标面板
│       │   └── StatusPill.tsx     # 状态标签
│       └── styles/
│           └── global.css         # 全局主题、报告、学习页、星图、Agent 样式
├── vscode-extension/            # VS Code 插件版
│   ├── src/
│   │   ├── extension.ts           # 插件激活、命令注册、心跳启动
│   │   ├── backendManager.ts      # 后端启动、健康检查、API 地址
│   │   ├── workspaceHeartbeat.ts  # workspace 心跳与项目树快照
│   │   ├── editorContext.ts       # 当前文件、选区、项目文件上下文收集
│   │   ├── agentExecutor.ts       # Agent pending/confirmed 任务处理与 WorkspaceEdit
│   │   ├── webviewPanel.ts        # 右侧编辑器面板
│   │   └── webviewView.ts         # 活动栏侧边栏视图
│   ├── webview-mini/             # 插件内简约 React Webview
│   └── package.json              # 插件命令、配置、打包脚本
├── docker-compose.yml           # MySQL + FastAPI + Nginx 前端
├── .dockerignore                # Docker 构建忽略规则
├── .env.example                 # 本地开发环境变量示例
├── .env.docker.example          # Docker 环境变量示例
├── requirements.txt             # 后端 Python 依赖
├── alembic.ini                  # Alembic 配置
├── start.bat                    # Windows 一键启动入口
└── start.ps1                    # 本地启动脚本
```



## 常见问题

### MySQL 连接失败

检查 `.env` 中 `DATABASE_URL` 的用户名、密码和端口是否正确。本地开发通常是：

```env
DATABASE_URL=mysql+pymysql://root:你的密码@127.0.0.1:3306/codelens_demo?charset=utf8mb4
```

### 没有 API Key

静态分析、历史、统计页面仍可使用，但报告生成和 AI 对话会返回友好错误。填写 `DEEPSEEK_API_KEY` 后重启后端。

### Docker 启动失败

先检查 Docker Desktop 是否运行：

```powershell
docker info
```

再检查配置：

```powershell
docker compose config
```

如果构建时报 `BuildKit`、`grpc` 或 session header 相关错误，可以临时关闭 BuildKit：

```powershell
$env:DOCKER_BUILDKIT="0"
$env:COMPOSE_DOCKER_CLI_BUILD="0"
docker compose build
docker compose up -d
```

如果提示端口被占用，修改 `.env` 中的 `FRONTEND_PORT`、`BACKEND_PORT` 或 `MYSQL_PORT` 后重新执行 `docker compose up -d`。

### 页面能打开但接口失败

本地开发模式确认后端为 `http://127.0.0.1:8000`。Docker 模式确认前端访问的是 `http://127.0.0.1:15173`，由 Nginx 代理 `/api` 到后端容器。

### Agent 页面显示插件未连接

Agent 的“当前项目”面板依赖 VS Code 插件每 5 秒上报一次 workspace heartbeat。排查顺序：

1. 确认 VS Code 中打开的是项目文件夹，而不是单个文件。
2. 确认插件输出面板没有 `Workspace heartbeat failed` 或 API 地址错误。
3. 浏览器打开 `http://127.0.0.1:8000/api/agent/workspace/current`，查看是否有 `workspace_name`、`updated_at` 和 `connected`。
4. 如果后端刚重启，重新打开插件面板或执行任意 CodeLens Pro 命令，插件会立即 flush 一次心跳。
5. 如果超过 20 秒没有心跳，Web 端会显示“插件未连接或状态已过期”。

### Agent 自动上下文和手动选文件有什么区别

- `手动选择`：Web 端项目树勾选相对路径，插件端读取这些文件内容。
- `AI 自动选择`：Web 端不勾文件，插件端上传项目文件清单，后端让 LLM 选择相关路径，再由插件读取文件内容。
- `手动 + AI 补充`：用户勾选核心文件，LLM 在文件清单中补充相关文件。

三种模式都不会让浏览器直接读取本地文件内容；最终读取发生在 VS Code 插件端，并会校验路径不能越出 workspace root。

### 每日日志空白日期能否保存

可以。`PATCH /api/daily-logs/{date}` 已支持 upsert：有日志则更新，无日志则创建手写日记。空正文会返回 400，避免保存只有标题的空日志。

## VS Code 插件版

项目额外提供一个本地 VS Code 插件 Demo，位于 `vscode-extension/`。插件不会替换当前 Web 版，而是与 Web 版共享 FastAPI 后端，并承担本地文件读取、项目树同步和 Agent 代码修改执行这些浏览器不适合直接完成的工作。

### 插件能力

- 命令面板打开 `CodeLens Pro: 打开右侧面板`，默认在当前代码编辑器右侧分栏显示。
- 命令面板打开 `CodeLens Pro: 打开侧边栏视图`，或点击左侧活动栏的 `CodeLens Pro` 图标，使用类似 AI 插件的侧边栏形态。
- 分析当前打开文件。
- 分析当前选中代码，未选中时自动降级为当前文件。
- 资源管理器右键文件后使用 CodeLens Pro 分析。
- 自动上报当前 VS Code workspace 名称、根目录、项目树和插件版本。
- Agent 任务执行时读取选中文件或 AI 自动选择的上下文文件。
- 对确认后的 Agent 修改计划使用 `WorkspaceEdit` 写回工作区，并向后端回传结果。
- 在简约 Webview 内完成静态分析、AI 流式报告、报告追问和最近历史查看。

### 插件界面形态

插件提供两种入口：

1. 右侧编辑器面板：执行 `CodeLens Pro: 打开右侧面板`，会在当前代码编辑器右侧打开简约 CodeLens Pro 页面，适合宽屏报告阅读。
2. 侧边栏视图：点击左侧活动栏 `CodeLens Pro` 图标，或执行 `CodeLens Pro: 打开侧边栏视图`，会打开类似 AI 助手插件的侧栏。VS Code 允许用户把侧栏视图拖到右侧辅助栏，从而形成截图中那种“右侧插件”体验。

插件版使用独立的 `vscode-extension/webview-mini/` 前端，视觉风格跟随 VS Code 原生主题，不复用 Web 版的大导航、统计页和复杂分栏。Web 版负责代码分析、知识沉淀和 Agent 协作三条主线，其中 Agent 页面中的项目树和上下文选择能力依赖插件端的心跳与任务执行服务。

### 插件与 Web 端协作

```text
VS Code 插件
  ├─ 每 5 秒 POST /api/agent/workspace/heartbeat
  ├─ 最多每 30 秒刷新一次项目树快照
  ├─ 读取 Web 端选中的 workspace 相对路径
  ├─ 调用 /api/agent/context/select 获取 AI 自动选择结果
  └─ 处理 pending/confirmed Agent 任务并回传执行结果

Web 端 Agent 页面
  ├─ GET /api/agent/workspace/current 展示当前项目
  ├─ 勾选文件或选择上下文模式
  ├─ POST /api/agent/plan 生成 Agent 计划
  └─ 确认计划后等待插件执行
```

项目树默认排除 `.git`、`node_modules`、`.venv`、`dist`、`build`、`__pycache__` 等目录，并限制深度和节点数量，避免过量同步。

### 插件本地调试

```powershell
# 1. 构建简约插件 Webview
cd vscode-extension\webview-mini
npm install
npm run build

# 2. 编译 VS Code 插件
cd ..
npm install
npm run compile
```

然后在 VS Code 中打开 `vscode-extension/`，按 `F5` 启动 Extension Development Host。

首次打开插件时会检测 `http://127.0.0.1:8000/api/health`。如果后端未运行且 `codelens.autoStartBackend=true`，插件会尝试执行：

```powershell
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

### 插件配置

VS Code 设置中可配置：

- `codelens.backendPort`：默认 `8000`
- `codelens.pythonPath`：默认 `python`
- `codelens.autoStartBackend`：默认 `true`
- `codelens.frontendMode`：默认 `webview`

### 插件打包

```powershell
cd vscode-extension
npm run package
```

打包脚本会先构建前端，再把 `frontend/dist`、`backend/`、`CodeLens/`、`alembic.ini`、`requirements.txt` 复制进插件目录，最后生成 `.vsix`。

## 注意事项

- Docker MySQL 数据保存在命名卷 `codelens_mysql_data` 中，删除卷会清空数据。
- Web 端项目树只展示路径元信息；代码内容读取由 VS Code 插件端完成。
- Agent 自动选择上下文依赖 LLM 和 VS Code 插件。如果 LLM 选择失败或返回空结果，插件端会回退到自动收集项目上下文。
- 活动星图依赖 Three.js，首次进入会加载独立 chunk；低性能设备上可通过系统“减少动态效果”降低动画强度。
- 知识卡片学习资料会缓存到 `learning_card_materials`，重新生成会覆盖当前缓存内容。
- 每日日志的 LLM 生成会基于当天数据库活动；手写日记不会自动引用报告或对话。
- `.env` 中包含 API Key 和数据库密码，不要提交到公开仓库。

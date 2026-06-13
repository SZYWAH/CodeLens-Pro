# CodeLens Pro

CodeLens Pro 是一个本地运行的智能代码分析 Demo，采用 **FastAPI + React + MySQL + DeepSeek API**。应用提供代码工作台、代码对比、AI 对话、历史报告和统计看板，适合课堂展示、课程设计和本地准产品原型演示。

> 本 README 只说明当前准产品版 Web 应用，不展开旧版 Streamlit 实现。

## 功能概览

- **代码工作台**：粘贴代码，选择语言、模型和分析模式，生成静态指标与 AI 流式报告。
- **代码对比**：输入两个版本代码，生成差异分析、性能对比和质量建议。
- **AI 对话**：普通聊天独立保存，历史对话支持搜索、筛选、删除和可收起边栏。
- **报告上下文对话**：工作台/代码对比生成报告后，可结合当前代码与报告继续追问。
- **历史报告**：报告自动命名、搜索、筛选、查看详情、删除，并支持回到对应功能页继续使用。
- **统计看板**：显示实时 API 余额、Token 统计、功能使用分布、活跃趋势、对话类型占比等。
- **本地持久化**：报告、静态指标、聊天会话和消息保存到本机 MySQL。

## 完成思路

本项目围绕“智能代码分析”这一应用场景进行设计，采用前后端分离的准产品版实现方式。前端负责提供接近真实软件的交互界面，包括代码编辑、模式选择、报告阅读、历史检索、AI 对话和统计看板；后端负责业务能力，包括静态代码分析、DeepSeek 大模型调用、SSE 流式输出、MySQL 持久化和使用数据统计。

整体实现先搭建 FastAPI 后端和 React 前端基础框架，再将核心功能拆成代码工作台、代码对比、普通 AI 对话、历史报告和统计页面。代码分析部分先通过本地静态扫描提取行数、函数数量和安全风险，再调用 LLM 生成结构化分析报告。报告生成、对比分析和 AI 对话统一采用 SSE 流式返回，提升交互体验。所有报告、指标、聊天会话和消息都会写入 MySQL，方便用户后续检索、继续分析和统计使用情况。最后补充 Docker Compose 封装，将前端、后端和 MySQL 组合为可复现的本地部署环境。

## 业务流程

1. 用户进入代码工作台或代码对比页面，粘贴待分析代码，并选择语言、模型和分析模式。
2. 前端将代码提交到后端，后端先执行静态分析，返回代码行数、函数数量和安全风险等基础指标。
3. 用户点击生成报告后，后端根据代码、语言和分析模式组装 Prompt，调用 DeepSeek API 生成 AI 报告。
4. 报告内容通过 SSE 实时流式返回前端，用户可以边生成边阅读，生成完成后报告和静态指标自动保存到 MySQL。
5. 用户可以在报告下方或全屏报告页中结合当前代码与报告继续向 AI 提问，形成与报告关联的上下文对话。
6. 普通 AI 对话页面独立提供聊天能力，不自动携带代码或报告上下文，适合自由提问，并保存历史聊天记录。
7. 历史报告页面支持搜索、筛选、查看详情、删除，并可回到工作台或代码对比页面继续基于旧报告使用。
8. 统计页面从数据库和 API 状态中汇总使用情况，展示余额、Token、报告数量、对话数量和功能使用趋势。

## 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind CSS、Monaco Editor、react-markdown、lucide-react
- 后端：FastAPI、SQLModel、SQLAlchemy、Alembic、PyMySQL
- 数据库：MySQL 8
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
DEEPSEEK_DEFAULT_MODEL_LABEL=dsV4flash
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
- `GET /api/analytics`：使用统计、Token 统计、余额分析。
- `POST /api/analyze/static`：静态代码分析。
- `POST /api/reports/stream`：单段代码 AI 报告，SSE 流式返回。
- `POST /api/diff/stream`：双版本代码对比报告，SSE 流式返回。
- `POST /api/chat/stream`：AI 对话，SSE 流式返回并保存。
- `GET /api/reports`：历史报告列表。
- `GET /api/reports/{id}`：历史报告详情。
- `DELETE /api/reports/{id}`：删除报告。
- `GET /api/chat/sessions`：聊天会话列表。
- `GET /api/chat/sessions/{id}`：聊天会话详情。
- `DELETE /api/chat/sessions/{id}`：删除聊天会话。

## 项目结构

```text
机器学习课堂展示/
├── backend/                     # FastAPI 后端
│   ├── Dockerfile               # 后端容器镜像
│   ├── alembic/                 # 数据库迁移
│   │   └── versions/            # Alembic 迁移脚本
│   ├── app/
│   │   ├── main.py              # FastAPI 实例、CORS、启动初始化
│   │   ├── config.py            # .env 配置读取
│   │   ├── db.py                # MySQL 初始化、迁移、Session
│   │   ├── models.py            # SQLModel 表模型
│   │   ├── schemas.py           # Pydantic 请求/响应模型
│   │   ├── api/
│   │   │   └── routes.py        # API 路由、SSE、报告/聊天/统计逻辑
│   │   ├── services/
│   │   │   ├── analyzer_service.py  # 静态分析：行数/函数/密钥风险
│   │   │   ├── llm_service.py       # DeepSeek 调用、报告/聊天/自动命名
│   │   │   ├── prompt_service.py    # 语言、模型、Prompt 模板适配
│   │   │   ├── sse.py               # SSE 事件格式化
│   │   │   └── usage_service.py     # 余额查询、Token 统计
│   │   └── resources/
│   │       └── deepseek_v3_tokenizer/ # 本地 tokenizer
│   └── tests/
│       └── test_analyzer_service.py # 静态分析单元测试
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
│       │   ├── WorkbenchPage.tsx # 代码工作台
│       │   ├── DiffPage.tsx      # 代码对比
│       │   ├── ChatPage.tsx      # AI 对话与可收起历史边栏
│       │   ├── HistoryPage.tsx   # 历史报告
│       │   └── SettingsPage.tsx  # 统计看板
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
│           └── global.css         # 全局样式、暗色主题、报告样式
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

## 注意事项

- Docker MySQL 数据保存在命名卷 `codelens_mysql_data` 中，删除卷会清空数据。

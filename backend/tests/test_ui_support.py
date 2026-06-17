import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session

import backend.app.api.routes as routes
from backend.app.api.routes import (
    _analytics_summary,
    _agent_plan_item,
    _confirm_agent_plan_row,
    _daily_calendar_item,
    _daily_work_context,
    _daily_work_log_item,
    _fallback_learning_card_material,
    _learning_card_item,
    _learning_card_material_item,
    _learning_card_material_placeholder,
    _normalize_learning_card_candidate,
    _learning_center,
    _learning_review,
    _metric_summary,
    _project_guide,
    _recent_activity,
    _agent_chat_context_requests,
    _create_agent_chat_context_request,
    confirm_agent_plan_stream,
    select_agent_context,
    list_pending_agent_chat_contexts,
    list_pending_agent_tasks,
    read_current_agent_workspace,
    update_daily_work_log,
    update_agent_workspace_heartbeat,
    error_payload,
    parse_report_outline,
    stream_agent_message,
)
from backend.app.models import AgentPlan, AnalysisMetric, ChatMessage, ChatSession, DailyWorkLog, LearningCard, LearningCardMaterial, Report
from backend.app.schemas import (
    AgentConfirmRequest,
    AgentContextFileCandidate,
    AgentContextSelectRequest,
    AgentMessageStreamRequest,
    AgentTaskProgressRequest,
    AgentWorkspaceHeartbeatRequest,
    AgentWorkspaceTreeNode,
    DailyWorkLogUpdateRequest,
)
from backend.app.services.llm_service import LLMService, _parse_json_object


async def _collect_streaming_body(response) -> str:
    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


def _create_memory_engine():
    return create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_parse_report_outline_extracts_markdown_headings():
    outline = parse_report_outline("# 总览\n正文\n## 代码结构\n### 风险提示\n#### 忽略")

    assert outline == [
        {"id": "总览", "text": "总览", "level": 1},
        {"id": "代码结构", "text": "代码结构", "level": 2},
        {"id": "风险提示", "text": "风险提示", "level": 3},
    ]


def test_error_payload_keeps_message_for_stream_compatibility():
    payload = error_payload("LLM_KEY_MISSING", "Key 未配置", "填写 .env")

    assert payload["code"] == "LLM_KEY_MISSING"
    assert payload["message"] == "Key 未配置"
    assert payload["hint"] == "填写 .env"


def test_learning_card_candidate_normalization_adds_defaults():
    candidate = _normalize_learning_card_candidate(
        {
            "title": " 字典推导式 ",
            "explanation": "用于快速构造字典。",
            "difficulty": "unknown",
            "tags": ["Python", "dict", "dict"],
            "source_reason": "报告中多次说明了重构循环的写法。",
            "confidence": 1.4,
        },
        fallback_language_label="Python",
        fallback_source_id="r1",
        fallback_source_title="缓存函数分析",
    )

    assert candidate.title == "字典推导式"
    assert candidate.difficulty == "入门"
    assert candidate.source_id == "r1"
    assert candidate.tags == ["Python", "dict"]
    assert candidate.resource_links
    assert candidate.confidence == 1.0


def test_metric_summary_compacts_static_metrics():
    summary = _metric_summary({"lines": 12, "functions": {"count": 3}, "secrets_risk": [{}, {}]})

    assert summary == {"lines": 12, "functions": 3, "risks": 2}


def test_recent_activity_and_summary_use_existing_tables():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE reports (
                id VARCHAR(32) PRIMARY KEY,
                title VARCHAR(160) NOT NULL,
                report_type VARCHAR(24) NOT NULL,
                mode VARCHAR(64) NOT NULL,
                language_label VARCHAR(32) NOT NULL,
                language_code VARCHAR(32) NOT NULL,
                model VARCHAR(96) NOT NULL,
                code_content TEXT,
                code_a TEXT,
                code_b TEXT,
                content TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE chat_sessions (
                id VARCHAR(32) PRIMARY KEY,
                title VARCHAR(160) NOT NULL,
                context_type VARCHAR(24) NOT NULL,
                report_id VARCHAR(32),
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id VARCHAR(32) NOT NULL,
                role VARCHAR(24) NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE agent_plans (
                id VARCHAR(32) PRIMARY KEY,
                session_id VARCHAR(32) NOT NULL,
                instruction TEXT NOT NULL,
                summary VARCHAR(500) NOT NULL,
                assumptions_json TEXT,
                warnings_json TEXT,
                operations_json TEXT,
                selected_files_json TEXT,
                context_mode VARCHAR(24),
                workspace_root VARCHAR(1024),
                status VARCHAR(24) NOT NULL,
                source VARCHAR(24) NOT NULL,
                apply_result TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE analysis_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id VARCHAR(32) NOT NULL,
                lines INTEGER NOT NULL,
                functions_count INTEGER NOT NULL,
                functions_json TEXT,
                secrets_json TEXT,
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE learning_cards (
                id VARCHAR(32) PRIMARY KEY,
                title VARCHAR(160) NOT NULL,
                explanation TEXT NOT NULL,
                language_label VARCHAR(32) NOT NULL,
                difficulty VARCHAR(24) NOT NULL,
                tags_json TEXT,
                source_type VARCHAR(32) NOT NULL,
                source_id VARCHAR(32),
                code_excerpt TEXT,
                detail_markdown TEXT,
                notes TEXT,
                resource_links_json TEXT,
                status VARCHAR(24) NOT NULL,
                last_reviewed_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE learning_card_materials (
                id VARCHAR(32) PRIMARY KEY,
                card_id VARCHAR(32) NOT NULL,
                content_markdown TEXT NOT NULL,
                source_links_json TEXT NOT NULL,
                model VARCHAR(96),
                generated_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE daily_work_logs (
                id VARCHAR(32) PRIMARY KEY,
                log_date DATETIME NOT NULL,
                title VARCHAR(160) NOT NULL,
                content_markdown TEXT NOT NULL,
                source_stats_json TEXT NOT NULL,
                source_refs_json TEXT NOT NULL,
                model VARCHAR(96),
                generated_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
    now = datetime.utcnow()

    with Session(engine) as session:
        report = Report(
            id="r1",
            title="缓存函数分析",
            report_type="single",
            mode="func_comment",
            language_label="Python",
            language_code="python",
            model="deepseek-v4-flash",
            code_content="def cache(): pass",
            content="# 报告\n正文",
            created_at=now - timedelta(minutes=3),
        )
        chat = ChatSession(
            id="c1",
            title="报告追问",
            context_type="report",
            report_id="r1",
            created_at=now - timedelta(minutes=2),
            updated_at=now - timedelta(minutes=2),
        )
        message = ChatMessage(
            session_id="c1",
            role="user",
            content="解释一下",
            created_at=now - timedelta(minutes=2),
        )
        plan = AgentPlan(
            id="a1",
            session_id="c1",
            instruction="优化代码",
            summary="优化缓存逻辑",
            selected_files_json='["backend/app/main.py", "../secret.py", "backend/app/main.py"]',
            context_mode="hybrid",
            workspace_root="d:/demo",
            status="waiting_confirm",
            source="plugin",
            created_at=now - timedelta(minutes=1),
            updated_at=now - timedelta(minutes=1),
        )
        metric = AnalysisMetric(
            report_id="r1",
            lines=20,
            functions_count=2,
            secrets_json="[]",
            created_at=now,
        )
        card = LearningCard(
            id="lc1",
            title="异常处理",
            explanation="理解 try-except 的错误兜底能力",
            language_label="Python",
            difficulty="入门",
            tags_json='["Python", "异常处理"]',
            source_type="manual",
            resource_links_json="[]",
            status="reviewing",
            created_at=now,
            updated_at=now,
        )
        session.add(report)
        session.add(chat)
        session.add(message)
        session.add(plan)
        session.add(metric)
        session.add(card)
        session.commit()

        summary = _analytics_summary(session)
        activity = _recent_activity(session, limit=5)
        learning = _learning_center(session)
        review = _learning_review(session, "all")
        daily_context = _daily_work_context(session, now.date())
        empty_day = now.date() - timedelta(days=2)
        empty_slot = _daily_calendar_item(session, empty_day, None)
        log = DailyWorkLog(
            id="dl1",
            log_date=datetime.combine(now.date(), datetime.min.time()),
            title="今日工作日志",
            content_markdown="# 今日工作日志\n\n## 今日概览\n完成了功能验证。",
            source_stats_json='{"reports":1,"messages":1,"agent_tasks":1,"learning_cards":1,"total_activity":4}',
            source_refs_json='[{"type":"report","id":"r1","title":"缓存函数分析"}]',
            model="test-model",
            generated_at=now,
            updated_at=now,
        )
        session.add(log)
        session.commit()
        daily_item = _daily_work_log_item(session, now.date(), log)
        plan_item = _agent_plan_item(plan)
        card_item = _learning_card_item(card)
        placeholder_material = _learning_card_material_placeholder(card)
        cached_material_row = LearningCardMaterial(
            id="m1",
            card_id="lc1",
            content_markdown="## 概念解释\n缓存资料",
            source_links_json='[{"title":"Python Tutorial","url":"https://docs.python.org/3/tutorial/"}]',
            model="test-model",
            generated_at=now,
            updated_at=now,
        )
        session.add(cached_material_row)
        session.commit()
        cached_material = _learning_card_material_item(card, cached_material_row, cached=True)

    assert summary["reports"] == 1
    assert summary["chat_sessions"] == 1
    assert summary["agent_tasks"] == 1
    assert summary["code_lines"] == 20
    assert [item["kind"] for item in activity[:3]] == ["agent", "chat", "report"]
    assert activity[0]["route"]["page"] == "agent"
    assert activity[1]["route"]["session_id"] == "c1"
    assert activity[2]["route"]["report_type"] == "single"
    assert plan_item.selected_file_paths == ["backend/app/main.py"]
    assert plan_item.context_mode == "hybrid"
    assert plan_item.workspace_root == "d:/demo"
    assert card_item.tags == ["Python", "异常处理"]
    assert card_item.resource_links
    assert "概念解释" in placeholder_material.content_markdown
    assert placeholder_material.cached is False
    assert cached_material.cached is True
    assert cached_material.model == "test-model"
    assert cached_material.source_links[0]["url"] == "https://docs.python.org/3/tutorial/"
    assert learning.stats["learning_cards"] == 1
    assert learning.next_actions[0]["page"] == "knowledgeCards"
    assert review.stats["learning_cards"] == 1
    assert review.recommendations
    assert daily_context["stats"]["total_activity"] == 4
    assert not empty_slot.has_activity
    assert daily_item.has_log
    assert daily_item.source_refs[0]["type"] == "report"
    assert "异常处理" in _fallback_learning_card_material(card, ["Python", "异常处理"])


def _create_daily_work_logs_table(engine):
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE reports (
                id VARCHAR(32) PRIMARY KEY,
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE agent_plans (
                id VARCHAR(32) PRIMARY KEY,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE learning_cards (
                id VARCHAR(32) PRIMARY KEY,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE daily_work_logs (
                id VARCHAR(32) PRIMARY KEY,
                log_date DATETIME NOT NULL,
                title VARCHAR(160) NOT NULL,
                content_markdown TEXT NOT NULL,
                source_stats_json TEXT NOT NULL,
                source_refs_json TEXT NOT NULL,
                model VARCHAR(96),
                generated_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))


def test_update_daily_work_log_creates_manual_log_for_empty_day():
    engine = create_engine("sqlite:///:memory:")
    _create_daily_work_logs_table(engine)
    day = (datetime.utcnow() - timedelta(days=1)).date()

    with Session(engine) as session:
        item = update_daily_work_log(
            day.isoformat(),
            DailyWorkLogUpdateRequest(title="随手日记", content_markdown="今天复盘了一下递归。"),
            session,
        )

    assert item.has_log is True
    assert item.title == "随手日记"
    assert item.content_markdown == "今天复盘了一下递归。"
    assert item.model is None
    assert item.source_refs == []


def test_update_daily_work_log_rejects_empty_manual_content():
    engine = create_engine("sqlite:///:memory:")
    _create_daily_work_logs_table(engine)
    day = (datetime.utcnow() - timedelta(days=1)).date()

    with Session(engine) as session, pytest.raises(HTTPException) as exc_info:
        update_daily_work_log(
            day.isoformat(),
            DailyWorkLogUpdateRequest(title="空日记", content_markdown="   "),
            session,
        )

    assert exc_info.value.status_code == 400


def test_agent_context_select_filters_to_candidate_paths(monkeypatch):
    class FakeLLMService:
        def __init__(self, model=None):
            self.model = model

        def select_agent_context_files(self, **kwargs):
            return {
                "selected_file_paths": [
                    "backend/app/main.py",
                    "../secret.py",
                    "backend/app/main.py",
                    "missing.py",
                ],
                "reasons": [
                    {"path": "backend/app/main.py", "reason": "entrypoint"},
                    {"path": "missing.py", "reason": "not in manifest"},
                ],
                "skipped": [{"path": "README.md", "reason": "docs only"}],
            }

    monkeypatch.setattr("backend.app.api.routes.check_database", lambda: (True, "ok"))
    monkeypatch.setattr("backend.app.api.routes.LLMService", FakeLLMService)

    response = select_agent_context(
        AgentContextSelectRequest(
            instruction="fix startup",
            context_mode="ai_auto",
            candidates=[
                AgentContextFileCandidate(path="backend/app/main.py", name="main.py"),
                AgentContextFileCandidate(path="README.md", name="README.md"),
            ],
        )
    )

    assert response.selected_file_paths == ["backend/app/main.py"]
    assert response.reasons == [{"path": "backend/app/main.py", "reason": "entrypoint"}]
    assert response.skipped == [{"path": "README.md", "reason": "docs only"}]


def test_parse_json_object_handles_utf8_bom_fenced_and_surrounding_text():
    fenced = "\ufeff说明文字\n```json\n{\"summary\":\"创建复现文档\",\"operations\":[]}\n```\n结束"
    surrounded = "模型说明：{\"summary\":\"中文计划\",\"operations\":[]}。"

    assert _parse_json_object(fenced)["summary"] == "创建复现文档"
    assert _parse_json_object(surrounded)["summary"] == "中文计划"
    with pytest.raises(ValueError):
        _parse_json_object("\ufeff这不是 JSON")


def test_agent_plan_repairs_non_json_model_response():
    service = object.__new__(LLMService)
    responses = iter([
        "我会创建一个复现说明文档，但这不是 JSON。",
        (
            '{"summary":"创建复现文档","assumptions":[],"warnings":[],'
            '"operations":[{"type":"create","path":"reproduce.md","new_path":null,'
            '"content":"# 复现\\n中文内容","reason":"补充复现说明"}]}'
        ),
    ])
    json_flags: list[bool] = []

    def fake_complete_text(messages, max_tokens=64, json_object=False):
        json_flags.append(json_object)
        return next(responses)

    service._complete_text = fake_complete_text
    plan = service.generate_agent_plan(
        instruction="请创建 reproduce.md 复现说明",
        code_context="",
        language_code="text",
        language_label="多文件",
        files=[
            {
                "fileName": "OpenAlex-MCP实验报告.md",
                "filePath": "OpenAlex-MCP实验报告.md",
                "languageId": "markdown",
                "code": "# OpenAlex MCP 实验报告\n",
            }
        ],
    )

    assert json_flags == [True, True]
    assert plan["summary"] == "创建复现文档"
    assert plan["operations"][0]["path"] == "reproduce.md"
    assert "中文内容" in plan["operations"][0]["content"]


def test_agent_plan_falls_back_to_openalex_reproduce_doc_after_json_failures():
    service = object.__new__(LLMService)
    responses = iter(["不是 JSON", "仍然不是 JSON"])

    def fake_complete_text(messages, max_tokens=64, json_object=False):
        return next(responses)

    service._complete_text = fake_complete_text
    plan = service.generate_agent_plan(
        instruction="这一点不错，帮我实现",
        code_context="",
        language_code="text",
        language_label="多文件",
        files=[
            {
                "fileName": "modelscope-openalex-mcp.json",
                "filePath": "modelscope-openalex-mcp.json",
                "languageId": "json",
                "code": "{\"name\":\"@cyanheads/openalex-mcp-server\"}",
            },
            {
                "fileName": "OpenAlex-MCP实验报告.md",
                "filePath": "OpenAlex-MCP实验报告.md",
                "languageId": "markdown",
                "code": "# OpenAlex MCP 实验报告\n",
            },
            {
                "fileName": "build_openalex_docx.py",
                "filePath": "build_openalex_docx.py",
                "languageId": "python",
                "code": "from docx import Document\n",
            },
        ],
        history=[
            {"role": "assistant", "content": "建议增加一个 reproduce.md，指导如何用同一配置从零运行实验。"},
        ],
    )

    operation = plan["operations"][0]
    assert plan["summary"] == "创建 OpenAlex 实验复现说明文档。"
    assert operation["type"] == "create"
    assert operation["path"] == "reproduce.md"
    assert "环境准备" in operation["content"]
    assert "OpenAlex MCP 实验复现说明" in operation["content"]
    assert "模型返回的计划 JSON 不完整" in plan["warnings"][0]


def test_agent_plan_falls_back_to_project_readme_after_json_failures():
    service = object.__new__(LLMService)
    responses = iter(["我会写 README，但这不是 JSON。", "还是不是 JSON"])

    def fake_complete_text(messages, max_tokens=64, json_object=False):
        return next(responses)

    service._complete_text = fake_complete_text
    plan = service.generate_agent_plan(
        instruction="能否根据你的分析帮我添加一个README.md文件",
        code_context="",
        language_code="text",
        language_label="多文件",
        files=[
            {
                "fileName": "Dockerfile",
                "filePath": "Dockerfile",
                "languageId": "dockerfile",
                "code": "FROM python:3.10-slim\nCMD [\"streamlit\", \"run\", \"app17.py\"]\n",
            },
            {
                "fileName": "requirements-base.txt",
                "filePath": "requirements-base.txt",
                "languageId": "text",
                "code": "streamlit==1.32.0\npandas==2.2.0\nplotly==5.18.0\n",
            },
            {
                "fileName": "requirements-ml.txt",
                "filePath": "requirements-ml.txt",
                "languageId": "text",
                "code": "bertopic==0.16.0\nsentence-transformers==2.5.1\nhdbscan==0.8.33\n",
            },
            {
                "fileName": "app17.py",
                "filePath": "app17.py",
                "languageId": "python",
                "code": "import streamlit as st\nst.set_page_config(page_title='机器学习课堂展示')\n",
            },
            {
                "fileName": "openalex_crawler.py",
                "filePath": "openalex_crawler.py",
                "languageId": "python",
                "code": "import requests\n",
            },
        ],
    )

    operation = plan["operations"][0]
    assert plan["summary"] == "创建或更新 README 项目说明文档。"
    assert operation["type"] == "create"
    assert operation["path"] == "README.md"
    assert "项目结构" in operation["content"]
    assert "requirements-base.txt" in operation["content"]
    assert "streamlit run app17.py" in operation["content"]
    assert "模型返回的计划 JSON 不完整" in plan["warnings"][0]


def test_agent_plan_keeps_json_failure_when_no_fallback_matches():
    service = object.__new__(LLMService)
    responses = iter(["不是 JSON", "仍然不是 JSON"])

    def fake_complete_text(messages, max_tokens=64, json_object=False):
        return next(responses)

    service._complete_text = fake_complete_text
    with pytest.raises(ValueError, match="Agent 计划不是有效 JSON"):
        service.generate_agent_plan(
            instruction="帮我实现",
            code_context="# Demo\n",
            language_code="markdown",
            language_label="Markdown",
            files=[
                {
                    "fileName": "README.md",
                    "filePath": "README.md",
                    "languageId": "markdown",
                    "code": "# Demo\n",
                }
            ],
        )


def test_agent_plan_falls_back_to_project_readme_after_empty_operations():
    service = object.__new__(LLMService)
    responses = iter([
        '{"summary":"添加 README","assumptions":[],"warnings":[],"operations":[]}',
        '{"summary":"添加 README","assumptions":[],"warnings":[],"operations":[]}',
    ])

    def fake_complete_text(messages, max_tokens=64, json_object=False):
        return next(responses)

    service._complete_text = fake_complete_text
    plan = service.generate_agent_plan(
        instruction="请为当前项目创建 README.md 项目说明文档",
        code_context="",
        language_code="text",
        language_label="多文件",
        files=[
            {
                "fileName": "README.md",
                "filePath": "README.md",
                "languageId": "markdown",
                "code": "",
            },
            {
                "fileName": "Dockerfile",
                "filePath": "Dockerfile",
                "languageId": "dockerfile",
                "code": "FROM python:3.10-slim\n",
            },
            {
                "fileName": "app17.py",
                "filePath": "app17.py",
                "languageId": "python",
                "code": "import streamlit as st\n",
            },
        ],
    )

    operation = plan["operations"][0]
    assert operation["type"] == "update"
    assert operation["path"] == "README.md"
    assert "本地运行" in operation["content"]
    assert "模型未生成具体文件操作" in plan["warnings"][0]


def test_agent_plan_accepts_local_edit_operations_after_empty_first_plan():
    service = object.__new__(LLMService)
    responses = iter([
        '{"summary":"需要引入 logging","assumptions":[],"warnings":[],"operations":[]}',
        (
            '{"summary":"引入 logging","assumptions":[],"warnings":[],"operations":[{'
            '"type":"update","path":"app17.py","new_path":null,"content":null,'
            '"reason":"用 logging 记录异常","edits":[{"search":"print(exc)","replace":"logger.exception(exc)"}]}]}'
        ),
    ])

    def fake_complete_text(messages, max_tokens=64, json_object=False):
        return next(responses)

    service._complete_text = fake_complete_text
    plan = service.generate_agent_plan(
        instruction="引入 logging 代替 print，记录重要操作和异常。",
        code_context="print(exc)\n",
        language_code="python",
        language_label="Python",
        files=[
            {
                "fileName": "app17.py",
                "filePath": "app17.py",
                "languageId": "python",
                "code": "print(exc)\n",
            }
        ],
        selected_file_paths=["app17.py"],
    )

    operation = plan["operations"][0]
    assert operation["type"] == "update"
    assert operation["path"] == "app17.py"
    assert operation["content"] is None
    assert operation["edits"] == [{"search": "print(exc)", "replace": "logger.exception(exc)"}]


def test_agent_chat_context_pending_filters_workspace_root():
    _agent_chat_context_requests.clear()
    try:
        first_id = _create_agent_chat_context_request(
            session_id="s1",
            message="分析当前项目",
            selected_file_paths=[],
            context_mode="ai_auto",
            workspace_root="D:\\ProjectA",
        )
        _create_agent_chat_context_request(
            session_id="s2",
            message="分析另一个项目",
            selected_file_paths=[],
            context_mode="ai_auto",
            workspace_root="D:\\ProjectB",
        )

        items = list_pending_agent_chat_contexts(limit=20, workspace_root="d:/projecta")

        assert [item.request_id for item in items] == [first_id]
        assert items[0].workspace_root == "d:/projecta"
    finally:
        _agent_chat_context_requests.clear()


def test_pending_agent_tasks_filter_workspace_root():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE agent_plans (
                id VARCHAR(32) PRIMARY KEY,
                session_id VARCHAR(32) NOT NULL,
                instruction TEXT NOT NULL,
                summary VARCHAR(500) NOT NULL,
                assumptions_json TEXT,
                warnings_json TEXT,
                operations_json TEXT,
                selected_files_json TEXT,
                context_mode VARCHAR(24),
                workspace_root VARCHAR(1024),
                status VARCHAR(24) NOT NULL,
                source VARCHAR(24) NOT NULL,
                apply_result TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))

    now = datetime.utcnow()
    with Session(engine) as session:
        session.add(AgentPlan(id="a1", session_id="s1", instruction="分析", summary="A", workspace_root="d:/projecta", status="pending", source="web", created_at=now, updated_at=now))
        session.add(AgentPlan(id="a2", session_id="s2", instruction="分析", summary="B", workspace_root="d:/projectb", status="pending", source="web", created_at=now, updated_at=now))
        session.commit()

        items = list_pending_agent_tasks(limit=20, workspace_root="D:\\ProjectA", session=session)

    assert [item.id for item in items] == ["a1"]
    assert items[0].workspace_root == "d:/projecta"


def _create_agent_plan_test_tables(engine):
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE chat_sessions (
                id VARCHAR(32) PRIMARY KEY,
                title VARCHAR(160) NOT NULL,
                context_type VARCHAR(24) NOT NULL,
                report_id VARCHAR(32),
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id VARCHAR(32) NOT NULL,
                role VARCHAR(24) NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE agent_plans (
                id VARCHAR(32) PRIMARY KEY,
                session_id VARCHAR(32) NOT NULL,
                instruction TEXT NOT NULL,
                summary VARCHAR(500) NOT NULL,
                assumptions_json TEXT,
                warnings_json TEXT,
                operations_json TEXT,
                selected_files_json TEXT,
                context_mode VARCHAR(24),
                workspace_root VARCHAR(1024),
                status VARCHAR(24) NOT NULL,
                source VARCHAR(24) NOT NULL,
                apply_result TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))


def test_update_agent_task_progress_records_utf8_message_and_selected_files():
    engine = _create_memory_engine()
    _create_agent_plan_test_tables(engine)
    routes._agent_plan_progress_events.clear()
    now = datetime.utcnow()

    try:
        with Session(engine) as session:
            session.add(ChatSession(id="s1", title="Agent", context_type="agent", created_at=now, updated_at=now))
            session.add(
                AgentPlan(
                    id="p1",
                    session_id="s1",
                    instruction="创建复现文档",
                    summary="等待插件处理",
                    selected_files_json="[]",
                    context_mode="ai_auto",
                    workspace_root="d:/projecta",
                    status="pending",
                    source="web",
                    created_at=now,
                    updated_at=now,
                )
            )
            session.commit()

            item = routes.update_agent_task_progress(
                "p1",
                AgentTaskProgressRequest(
                    phase="read_selected_files",
                    message="正在读取 OpenAlex 项目文件...",
                    detail="已进入插件文件读取阶段。",
                    selected_file_paths=["OpenAlex-MCP实验报告.md", "../secret.py", "OpenAlex-MCP实验报告.md"],
                ),
                session,
            )

        assert item.apply_result == "正在读取 OpenAlex 项目文件..."
        assert item.selected_file_paths == ["OpenAlex-MCP实验报告.md"]
        event = routes._agent_plan_progress_events["p1"][0]
        assert event["phase"] == "agent_plan_read_selected_files"
        assert event["message"] == "正在读取 OpenAlex 项目文件..."
        assert event["selected_file_paths"] == ["OpenAlex-MCP实验报告.md"]
    finally:
        routes._agent_plan_progress_events.clear()


def test_stream_agent_plan_progress_forwards_progress_and_final_plan(monkeypatch):
    engine = _create_memory_engine()
    _create_agent_plan_test_tables(engine)
    routes._agent_plan_progress_events.clear()
    now = datetime.utcnow()
    monkeypatch.setattr(routes, "engine", engine)

    try:
        with Session(engine) as session:
            session.add(ChatSession(id="s1", title="Agent", context_type="agent", created_at=now, updated_at=now))
            session.add(
                AgentPlan(
                    id="p1",
                    session_id="s1",
                    instruction="创建复现文档",
                    summary="创建 OpenAlex 复现说明",
                    operations_json='[{"type":"create","path":"reproduce.md","content":"# 复现"}]',
                    selected_files_json='["OpenAlex-MCP实验报告.md"]',
                    context_mode="ai_auto",
                    workspace_root="d:/projecta",
                    status="waiting_confirm",
                    source="web",
                    apply_result="计划已生成，等待网页确认执行。",
                    created_at=now,
                    updated_at=now,
                )
            )
            session.commit()

        routes._record_agent_plan_progress(
            "p1",
            AgentTaskProgressRequest(
                phase="context_ready",
                message="已打包项目上下文，准备生成计划。",
                detail="上下文 1 个文件。",
                selected_file_paths=["OpenAlex-MCP实验报告.md"],
            ),
        )

        body = "".join(routes._stream_agent_plan_progress_until_done("p1", "s1", "Agent"))

        assert "event: status" in body
        assert "已打包项目上下文，准备生成计划。" in body
        assert "计划已生成，等待网页确认执行。" in body
        assert "event: plan" in body
        assert "event: done" in body
        assert '"status": "waiting_confirm"' in body
        assert "reproduce.md" in body
    finally:
        routes._agent_plan_progress_events.clear()


def test_confirm_agent_plan_row_marks_confirmed_and_writes_message():
    engine = _create_memory_engine()
    _create_agent_plan_test_tables(engine)
    now = datetime.utcnow()

    with Session(engine) as session:
        session.add(ChatSession(id="s1", title="Agent", context_type="agent", created_at=now, updated_at=now))
        session.add(
            AgentPlan(
                id="p1",
                session_id="s1",
                instruction="创建脚本",
                summary="创建脚本",
                operations_json='[{"type":"create","path":"run.py","content":"print(1)"}]',
                selected_files_json="[]",
                context_mode="ai_auto",
                workspace_root="d:/projecta",
                status="waiting_confirm",
                source="web",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

        plan = _confirm_agent_plan_row(session, "p1", AgentConfirmRequest(action="apply", message="确认执行"))
        messages = [row[0] for row in session.exec(text("SELECT content FROM chat_messages")).all()]

    assert plan.status == "confirmed"
    assert plan.apply_result == "确认执行"
    assert messages == ["确认执行"]


def test_stream_agent_message_revision_rejects_old_plan_and_inherits_workspace(monkeypatch):
    engine = _create_memory_engine()
    _create_agent_plan_test_tables(engine)
    now = datetime.utcnow()
    monkeypatch.setattr(routes, "engine", engine)
    monkeypatch.setattr(routes, "check_database", lambda: (True, "ok"))
    monkeypatch.setattr(routes, "_agent_workspace_root_is_online", lambda workspace_root: workspace_root == "d:/projecta")
    monkeypatch.setattr(
        routes,
        "_stream_agent_plan_progress_until_done",
        lambda plan_id, session_id, title: iter([routes.sse_event("done", {"plan_id": plan_id, "mode": "plan"})]),
    )

    with Session(engine) as session:
        session.add(ChatSession(id="s1", title="Agent", context_type="agent", created_at=now, updated_at=now))
        session.add(
            AgentPlan(
                id="p1",
                session_id="s1",
                instruction="创建脚本",
                summary="创建脚本",
                warnings_json='["提醒"]',
                operations_json='[{"type":"create","path":"run.py","content":"print(1)"}]',
                selected_files_json='["README.md"]',
                context_mode="ai_auto",
                workspace_root="d:/projecta",
                status="waiting_confirm",
                source="web",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

    response = stream_agent_message(
        AgentMessageStreamRequest(
            message="把文件名改成 openalex_pipeline.py",
            session_id="s1",
            intent="plan",
            context_mode="ai_auto",
            source="web",
            plan_id="p1",
        )
    )
    body = asyncio.run(_collect_streaming_body(response))

    with Session(engine) as session:
        old_plan = session.get(AgentPlan, "p1")
        new_plans = list(session.exec(text("SELECT workspace_root, selected_files_json, instruction FROM agent_plans WHERE id != 'p1'")).all())

    assert "event: plan" in body
    assert old_plan is not None
    assert old_plan.status == "rejected"
    assert old_plan.apply_result == "已根据调整建议生成新版计划，旧计划不再执行。"
    assert len(new_plans) == 1
    assert new_plans[0][0] == "d:/projecta"
    assert new_plans[0][1] == '["README.md"]'
    assert "上一版计划摘要" in new_plans[0][2]


def test_confirm_agent_plan_stream_emits_rejected_plan(monkeypatch):
    engine = _create_memory_engine()
    _create_agent_plan_test_tables(engine)
    now = datetime.utcnow()
    monkeypatch.setattr(routes, "engine", engine)
    monkeypatch.setattr(routes, "check_database", lambda: (True, "ok"))

    with Session(engine) as session:
        session.add(ChatSession(id="s1", title="Agent", context_type="agent", created_at=now, updated_at=now))
        session.add(
            AgentPlan(
                id="p1",
                session_id="s1",
                instruction="创建脚本",
                summary="创建脚本",
                operations_json='[{"type":"create","path":"run.py","content":"print(1)"}]',
                selected_files_json="[]",
                context_mode="ai_auto",
                workspace_root="d:/projecta",
                status="waiting_confirm",
                source="web",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

    response = confirm_agent_plan_stream("p1", AgentConfirmRequest(action="reject", message="暂不执行"))
    body = asyncio.run(_collect_streaming_body(response))

    assert "event: status" in body
    assert "event: plan" in body
    assert "event: done" in body
    assert '"status": "rejected"' in body
    assert "暂不执行" in body


def test_update_agent_plan_apply_result_allows_confirmed_progress():
    engine = _create_memory_engine()
    _create_agent_plan_test_tables(engine)
    now = datetime.utcnow()

    with Session(engine) as session:
        session.add(ChatSession(id="s1", title="Agent", context_type="agent", created_at=now, updated_at=now))
        session.add(
            AgentPlan(
                id="p1",
                session_id="s1",
                instruction="引入 logging",
                summary="引入 logging",
                operations_json='[{"type":"update","path":"app17.py","content":null,"edits":[{"search":"print(exc)","replace":"logger.exception(exc)"}]}]',
                selected_files_json='["app17.py"]',
                context_mode="ai_auto",
                workspace_root="d:/projecta",
                status="confirmed",
                source="web",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

        item = routes.update_agent_plan_apply_result(
            "p1",
            routes.AgentApplyResultRequest(status="confirmed", message="正在准备第 1/1 个操作：update app17.py"),
            session,
        )

    assert item.status == "confirmed"
    assert item.apply_result == "正在准备第 1/1 个操作：update app17.py"


def test_agent_workspace_heartbeat_returns_current_snapshot():
    routes._agent_workspace_snapshot = None
    routes._agent_workspace_snapshots.clear()
    payload = AgentWorkspaceHeartbeatRequest(
        workspace_name="demo",
        workspace_root="D:/demo",
        status="connected",
        tree=AgentWorkspaceTreeNode(
            name="demo",
            path="",
            type="directory",
            children=[
                AgentWorkspaceTreeNode(name="src", path="src", type="directory"),
                AgentWorkspaceTreeNode(name="main.py", path="src/main.py", type="file"),
                AgentWorkspaceTreeNode(name="README.md", path="README.md", type="file"),
            ],
        ),
        node_count=4,
        truncated=False,
        plugin_version="0.1.0",
    )

    snapshot = update_agent_workspace_heartbeat(payload)
    current = read_current_agent_workspace()
    guide = _project_guide(None)

    assert snapshot.connected is True
    assert snapshot.stale is False
    assert current.workspace_name == "demo"
    assert current.tree is not None
    assert current.tree.children[0].path == "src"
    assert guide.workspace["name"] == "demo"
    assert any(item["path"] == "README.md" for item in guide.entry_candidates)
    assert "Python 模块组织" in guide.knowledge_points


def test_empty_workspace_heartbeat_does_not_override_current_project():
    routes._agent_workspace_snapshot = None
    routes._agent_workspace_snapshots.clear()
    project_payload = AgentWorkspaceHeartbeatRequest(
        workspace_name="ProjectA",
        workspace_root="D:/ProjectA",
        status="connected",
        tree=AgentWorkspaceTreeNode(name="ProjectA", path="", type="directory"),
        node_count=1,
        truncated=False,
        plugin_version="0.1.0",
    )
    empty_payload = AgentWorkspaceHeartbeatRequest(
        workspace_name="",
        workspace_root="",
        status="no_workspace",
        tree=None,
        node_count=0,
        truncated=False,
        plugin_version="0.1.0",
    )

    update_agent_workspace_heartbeat(project_payload)
    empty_snapshot = update_agent_workspace_heartbeat(empty_payload)
    current = read_current_agent_workspace()
    current_by_root = read_current_agent_workspace("D:\\ProjectA")

    assert empty_snapshot.status == "no_workspace"
    assert current.workspace_name == "ProjectA"
    assert current.workspace_root == "d:/projecta"
    assert current_by_root.workspace_name == "ProjectA"

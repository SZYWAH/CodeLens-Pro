from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlmodel import Session

from backend.app.api.routes import (
    _analytics_summary,
    _agent_plan_item,
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
    select_agent_context,
    read_current_agent_workspace,
    update_daily_work_log,
    update_agent_workspace_heartbeat,
    error_payload,
    parse_report_outline,
)
from backend.app.models import AgentPlan, AnalysisMetric, ChatMessage, ChatSession, DailyWorkLog, LearningCard, LearningCardMaterial, Report
from backend.app.schemas import AgentContextFileCandidate, AgentContextSelectRequest, AgentWorkspaceHeartbeatRequest, AgentWorkspaceTreeNode, DailyWorkLogUpdateRequest


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


def test_agent_workspace_heartbeat_returns_current_snapshot():
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

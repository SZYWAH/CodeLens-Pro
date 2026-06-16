from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.utcnow()


class Report(SQLModel, table=True):
    __tablename__ = "reports"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    title: str = Field(max_length=160, index=True)
    report_type: str = Field(max_length=24, index=True)
    mode: str = Field(max_length=64, index=True)
    language_label: str = Field(max_length=32, index=True)
    language_code: str = Field(max_length=32, index=True)
    model: str = Field(max_length=96)
    code_content: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    code_a: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    code_b: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    content: str = Field(sa_column=Column(LONGTEXT))
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime, nullable=False, index=True),
    )


class AnalysisMetric(SQLModel, table=True):
    __tablename__ = "analysis_metrics"

    id: int | None = Field(default=None, primary_key=True)
    report_id: str = Field(sa_column=Column(ForeignKey("reports.id", ondelete="CASCADE"), index=True))
    lines: int = 0
    functions_count: int = 0
    functions_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    secrets_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False))


class ChatSession(SQLModel, table=True):
    __tablename__ = "chat_sessions"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    title: str = Field(max_length=160, index=True)
    context_type: str = Field(default="general", max_length=24, index=True)
    report_id: str | None = Field(
        default=None,
        sa_column=Column(ForeignKey("reports.id", ondelete="SET NULL"), index=True),
    )
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(sa_column=Column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True))
    role: str = Field(max_length=24, index=True)
    content: str = Field(sa_column=Column(LONGTEXT))
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))


class AgentPlan(SQLModel, table=True):
    __tablename__ = "agent_plans"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    session_id: str = Field(sa_column=Column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True))
    instruction: str = Field(sa_column=Column(LONGTEXT))
    summary: str = Field(default="", max_length=500)
    assumptions_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    warnings_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    operations_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    selected_files_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    context_mode: str = Field(default="manual", max_length=24, index=True)
    status: str = Field(default="pending", max_length=24, index=True)
    source: str = Field(default="plugin", max_length=24, index=True)
    apply_result: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))


class CodeSnippet(SQLModel, table=True):
    __tablename__ = "code_snippets"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    title: str = Field(max_length=160, index=True)
    language_label: str = Field(max_length=32, index=True)
    language_code: str = Field(max_length=32, index=True)
    code_content: str = Field(sa_column=Column(LONGTEXT))
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))


class LearningCard(SQLModel, table=True):
    __tablename__ = "learning_cards"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    title: str = Field(max_length=160, index=True)
    explanation: str = Field(sa_column=Column(LONGTEXT))
    language_label: str = Field(default="通用", max_length=32, index=True)
    difficulty: str = Field(default="入门", max_length=24, index=True)
    tags_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    source_type: str = Field(default="manual", max_length=32, index=True)
    source_id: str | None = Field(default=None, max_length=32, index=True)
    code_excerpt: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    detail_markdown: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    notes: str | None = Field(default=None, sa_column=Column(LONGTEXT))
    resource_links_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    status: str = Field(default="new", max_length=24, index=True)
    last_reviewed_at: datetime | None = Field(default=None, sa_column=Column(DateTime, nullable=True, index=True))
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))


class LearningCardMaterial(SQLModel, table=True):
    __tablename__ = "learning_card_materials"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    card_id: str = Field(sa_column=Column(ForeignKey("learning_cards.id", ondelete="CASCADE"), nullable=False, index=True))
    content_markdown: str = Field(sa_column=Column(LONGTEXT))
    source_links_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    model: str | None = Field(default=None, max_length=96)
    generated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))


class DailyWorkLog(SQLModel, table=True):
    __tablename__ = "daily_work_logs"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    log_date: datetime = Field(sa_column=Column(DateTime, nullable=False, index=True))
    title: str = Field(default="每日工作日志", max_length=160)
    content_markdown: str = Field(sa_column=Column(LONGTEXT))
    source_stats_json: str = Field(default="{}", sa_column=Column(LONGTEXT))
    source_refs_json: str = Field(default="[]", sa_column=Column(LONGTEXT))
    model: str | None = Field(default=None, max_length=96)
    generated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))

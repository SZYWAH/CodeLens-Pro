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


class CodeSnippet(SQLModel, table=True):
    __tablename__ = "code_snippets"

    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)
    title: str = Field(max_length=160, index=True)
    language_label: str = Field(max_length=32, index=True)
    language_code: str = Field(max_length=32, index=True)
    code_content: str = Field(sa_column=Column(LONGTEXT))
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(DateTime, nullable=False, index=True))

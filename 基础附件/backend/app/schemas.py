from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class StaticAnalyzeRequest(BaseModel):
    code: str = ""
    language_code: str = "python"


class ReportStreamRequest(BaseModel):
    code: str
    mode: str
    language_code: str = "python"
    language_label: str = "Python"
    model: str | None = None


class DiffStreamRequest(BaseModel):
    code_a: str
    code_b: str
    mode: str
    language_code: str = "python"
    language_label: str = "Python"
    model: str | None = None


class ChatStreamRequest(BaseModel):
    message: str
    session_id: str | None = None
    report_id: str | None = None
    context_type: str = "general"
    code_context: str | None = None
    report_context: str | None = None
    model: str | None = None


class ReportListItem(BaseModel):
    id: str
    title: str
    report_type: str
    mode: str
    language_label: str
    language_code: str
    model: str
    created_at: datetime


class ReportDetail(ReportListItem):
    code_content: str | None = None
    code_a: str | None = None
    code_b: str | None = None
    content: str
    metrics: dict[str, Any] | None = None
    chat_session_id: str | None = None


class ChatMessageItem(BaseModel):
    id: int | None = None
    session_id: str
    role: str
    content: str
    created_at: datetime


class ChatSessionListItem(BaseModel):
    id: str
    title: str
    context_type: str
    report_id: str | None = None
    report_title: str | None = None
    created_at: datetime
    updated_at: datetime


class ChatSessionDetail(ChatSessionListItem):
    messages: list[ChatMessageItem] = Field(default_factory=list)


class DeleteResponse(BaseModel):
    ok: bool = True


class HealthResponse(BaseModel):
    backend: str = "ok"
    mysql_ok: bool
    mysql_message: str
    llm_key_configured: bool


class SettingsResponse(BaseModel):
    models: dict[str, str]
    default_model: str
    default_model_label: str
    languages: dict[str, str]
    default_language_label: str
    base_url: str
    llm_key_configured: bool
    mysql_ok: bool
    mysql_message: str
    report_modes: dict[str, list[dict[str, str]]] = Field(default_factory=dict)


class AnalyticsResponse(BaseModel):
    totals: dict[str, int]
    tool_usage: list[dict[str, Any]]
    report_type_counts: list[dict[str, Any]]
    report_mode_counts: list[dict[str, Any]]
    chat_type_counts: list[dict[str, Any]]
    daily_activity: list[dict[str, Any]]
    token_usage: dict[str, Any]
    api_balance: dict[str, Any]

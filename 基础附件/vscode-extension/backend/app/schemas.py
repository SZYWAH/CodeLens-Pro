from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

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
    generate_learning_card_candidates: bool = False


class DiffStreamRequest(BaseModel):
    code_a: str
    code_b: str
    mode: str
    language_code: str = "python"
    language_label: str = "Python"
    model: str | None = None
    generate_learning_card_candidates: bool = False


class ChatStreamRequest(BaseModel):
    message: str
    session_id: str | None = None
    report_id: str | None = None
    context_type: str = "general"
    code_context: str | None = None
    report_context: str | None = None
    model: str | None = None


class AgentFileContext(BaseModel):
    code: str = ""
    languageId: str | None = None
    fileName: str | None = None
    filePath: str | None = None
    attention: Literal["low", "normal", "high"] = "normal"


AgentContextMode = Literal["manual", "ai_auto", "hybrid"]
AgentMessageIntent = Literal["auto", "chat", "plan"]


class AgentPlanRequest(BaseModel):
    instruction: str
    session_id: str | None = None
    task_id: str | None = None
    agent_action: Literal["chat", "plan"] = "plan"
    defer_to_plugin: bool = False
    code_context: str = ""
    language_code: str = "python"
    language_label: str = "Python"
    file_name: str | None = None
    file_path: str | None = None
    report_context: str | None = None
    files: list[AgentFileContext] = Field(default_factory=list)
    selected_file_paths: list[str] = Field(default_factory=list)
    context_mode: AgentContextMode = "manual"
    model: str | None = None
    source: str = "plugin"
    workspace_root: str | None = None


class AgentContextFileCandidate(BaseModel):
    path: str
    name: str | None = None
    extension: str | None = None
    language: str | None = None
    size: int | None = None
    depth: int | None = None


class AgentContextSelectRequest(BaseModel):
    instruction: str
    context_mode: AgentContextMode = "ai_auto"
    selected_file_paths: list[str] = Field(default_factory=list)
    candidates: list[AgentContextFileCandidate] = Field(default_factory=list)
    model: str | None = None


class AgentContextSelectResponse(BaseModel):
    selected_file_paths: list[str] = Field(default_factory=list)
    reasons: list[dict[str, str]] = Field(default_factory=list)
    skipped: list[dict[str, str]] = Field(default_factory=list)


class AgentChatStreamRequest(BaseModel):
    message: str
    session_id: str | None = None
    code_context: str = ""
    report_context: str | None = None
    files: list[AgentFileContext] = Field(default_factory=list)
    selected_file_paths: list[str] = Field(default_factory=list)
    context_mode: AgentContextMode = "manual"
    model: str | None = None
    source: str = "plugin"
    workspace_root: str | None = None


class AgentMessageStreamRequest(AgentChatStreamRequest):
    intent: AgentMessageIntent = "auto"


class AgentChatContextRequestItem(BaseModel):
    request_id: str
    session_id: str
    message: str
    selected_file_paths: list[str] = Field(default_factory=list)
    context_mode: AgentContextMode = "manual"
    created_at: datetime


class AgentChatContextResultRequest(BaseModel):
    status: Literal["ok", "failed"]
    message: str = ""
    files: list[AgentFileContext] = Field(default_factory=list)
    selected_file_paths: list[str] = Field(default_factory=list)


class AgentOperation(BaseModel):
    type: Literal["create", "update", "delete", "rename"]
    path: str
    new_path: str | None = None
    content: str | None = None
    reason: str | None = None


class AgentPlanResponse(BaseModel):
    session_id: str | None = None
    plan_id: str | None = None
    title: str | None = None
    summary: str
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    operations: list[AgentOperation] = Field(default_factory=list)
    selected_file_paths: list[str] = Field(default_factory=list)
    context_mode: AgentContextMode = "manual"
    status: str = "pending"
    source: str = "plugin"


class AgentPlanItem(AgentPlanResponse):
    id: str
    session_id: str
    instruction: str
    apply_result: str | None = None
    created_at: datetime
    updated_at: datetime


class AgentApplyResultRequest(BaseModel):
    status: Literal["applied", "failed", "rejected"]
    message: str = ""


class AgentConfirmRequest(BaseModel):
    action: Literal["apply", "reject"]
    message: str = ""


class AgentTaskResultRequest(BaseModel):
    status: str
    message: str = ""
    summary: str | None = None
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    operations: list[AgentOperation] = Field(default_factory=list)


class AgentWorkspaceTreeNode(BaseModel):
    name: str
    path: str = ""
    type: Literal["file", "directory"]
    children: list["AgentWorkspaceTreeNode"] = Field(default_factory=list)
    truncated: bool = False


class AgentWorkspaceHeartbeatRequest(BaseModel):
    workspace_name: str = ""
    workspace_root: str = ""
    status: str = "connected"
    tree: AgentWorkspaceTreeNode | None = None
    node_count: int = 0
    truncated: bool = False
    plugin_version: str | None = None


class AgentWorkspaceSnapshot(AgentWorkspaceHeartbeatRequest):
    connected: bool = False
    stale: bool = True
    updated_at: datetime | None = None


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
    agent_plans: list[AgentPlanItem] = Field(default_factory=list)


class LearningCardItem(BaseModel):
    id: str
    title: str
    explanation: str
    language_label: str
    difficulty: str
    tags: list[str] = Field(default_factory=list)
    source_type: str
    source_id: str | None = None
    code_excerpt: str | None = None
    detail_markdown: str | None = None
    notes: str | None = None
    resource_links: list[dict[str, str]] = Field(default_factory=list)
    status: str
    last_reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LearningCardCreateRequest(BaseModel):
    title: str
    explanation: str
    language_label: str = "通用"
    difficulty: str = "入门"
    tags: list[str] = Field(default_factory=list)
    source_type: str = "manual"
    source_id: str | None = None
    code_excerpt: str | None = None
    detail_markdown: str | None = None
    notes: str | None = None
    resource_links: list[dict[str, str]] | None = None
    status: str = "new"


class LearningCardCandidate(BaseModel):
    title: str
    explanation: str
    language_label: str = "通用"
    difficulty: str = "入门"
    tags: list[str] = Field(default_factory=list)
    source_type: str = "report"
    source_id: str | None = None
    code_excerpt: str | None = None
    detail_markdown: str | None = None
    resource_links: list[dict[str, str]] = Field(default_factory=list)
    source_reason: str | None = None
    confidence: float | None = None


class LearningCardBulkCreateRequest(BaseModel):
    cards: list[LearningCardCandidate] = Field(default_factory=list)


class LearningCardBulkCreateResponse(BaseModel):
    created: int
    skipped: int
    cards: list[LearningCardItem] = Field(default_factory=list)


class LearningCardUpdateRequest(BaseModel):
    title: str | None = None
    explanation: str | None = None
    language_label: str | None = None
    difficulty: str | None = None
    tags: list[str] | None = None
    code_excerpt: str | None = None
    detail_markdown: str | None = None
    notes: str | None = None
    resource_links: list[dict[str, str]] | None = None
    status: str | None = None


class LearningCardGenerateRequest(BaseModel):
    source_limit: int = Field(default=10, ge=1, le=30)
    model: str | None = None


class LearningCardGenerateResponse(BaseModel):
    created: int
    skipped: int
    cards: list[LearningCardItem] = Field(default_factory=list)
    candidates: list[LearningCardCandidate] = Field(default_factory=list)


class LearningCardTagSuggestion(BaseModel):
    id: str
    action: str
    title: str
    reason: str
    card_ids: list[str] = Field(default_factory=list)
    from_tags: list[str] = Field(default_factory=list)
    to_tags: list[str] = Field(default_factory=list)


class LearningCardTagSuggestionRequest(BaseModel):
    limit: int = Field(default=120, ge=1, le=300)
    model: str | None = None


class LearningCardTagSuggestionResponse(BaseModel):
    suggestions: list[LearningCardTagSuggestion] = Field(default_factory=list)


class LearningCardApplyTagSuggestionsRequest(BaseModel):
    suggestions: list[LearningCardTagSuggestion] = Field(default_factory=list)


class LearningCardApplyTagSuggestionsResponse(BaseModel):
    updated: int
    cards: list[LearningCardItem] = Field(default_factory=list)


class LearningCardMaterialItem(BaseModel):
    card_id: str
    content_markdown: str
    source_links: list[dict[str, str]] = Field(default_factory=list)
    model: str | None = None
    generated_at: datetime | None = None
    updated_at: datetime | None = None
    cached: bool = False


class LearningCardMaterialGenerateRequest(BaseModel):
    model: str | None = None


class LearningCenterResponse(BaseModel):
    stats: dict[str, Any]
    route_steps: list[dict[str, Any]]
    weak_points: list[dict[str, Any]]
    recent_learning: list[dict[str, Any]]
    next_actions: list[dict[str, Any]]


class ProjectGuideResponse(BaseModel):
    workspace: dict[str, Any]
    entry_candidates: list[dict[str, Any]]
    core_areas: list[dict[str, Any]]
    read_order: list[dict[str, Any]]
    project_structure: dict[str, Any] | None = None
    knowledge_points: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class LearningReviewResponse(BaseModel):
    period: str
    summary: str
    stats: dict[str, Any]
    focus_areas: list[dict[str, Any]]
    recurring_topics: list[dict[str, Any]]
    timeline: list[dict[str, Any]]
    recommendations: list[dict[str, Any]]


class LLMKeySaveRequest(BaseModel):
    api_key: str


class LLMKeyTestRequest(BaseModel):
    api_key: str | None = None


class LLMKeyStatusResponse(BaseModel):
    configured: bool
    source: str
    masked_key: str = ""
    updated_at: str | None = None
    base_url: str


class LLMKeyTestResponse(BaseModel):
    ok: bool
    status: str
    detail: str
    key_status: dict[str, Any] | None = None
    balance: dict[str, Any] | None = None


class DailyWorkLogCalendarItem(BaseModel):
    date: str
    weekday: str
    has_activity: bool
    has_log: bool
    activity_score: int = 0
    title: str | None = None
    summary: str | None = None
    generated_at: datetime | None = None
    stats: dict[str, Any] = Field(default_factory=dict)


class DailyWorkLogItem(BaseModel):
    id: str | None = None
    date: str
    title: str
    content_markdown: str
    source_stats: dict[str, Any] = Field(default_factory=dict)
    source_refs: list[dict[str, Any]] = Field(default_factory=list)
    model: str | None = None
    generated_at: datetime | None = None
    updated_at: datetime | None = None
    has_activity: bool = False
    has_log: bool = False


class DailyWorkLogGenerateRequest(BaseModel):
    model: str | None = None


class DailyWorkLogUpdateRequest(BaseModel):
    title: str | None = None
    content_markdown: str | None = None


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

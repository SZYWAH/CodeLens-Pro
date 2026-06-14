from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlmodel import Session, select

from backend.app.config import settings
from backend.app.db import check_database, engine, get_session
from backend.app.models import AgentPlan, AnalysisMetric, ChatMessage, ChatSession, DailyWorkLog, LearningCard, LearningCardMaterial, Report
from backend.app.schemas import (
    AgentApplyResultRequest,
    AgentChatStreamRequest,
    AgentConfirmRequest,
    AgentContextSelectRequest,
    AgentContextSelectResponse,
    AgentPlanItem,
    AgentPlanRequest,
    AgentPlanResponse,
    AgentTaskResultRequest,
    AgentWorkspaceHeartbeatRequest,
    AgentWorkspaceSnapshot,
    AnalyticsResponse,
    ChatSessionDetail,
    ChatSessionListItem,
    ChatStreamRequest,
    DailyWorkLogCalendarItem,
    DailyWorkLogGenerateRequest,
    DailyWorkLogItem,
    DailyWorkLogUpdateRequest,
    DeleteResponse,
    DiffStreamRequest,
    HealthResponse,
    LearningCardCreateRequest,
    LearningCardBulkCreateRequest,
    LearningCardBulkCreateResponse,
    LearningCardCandidate,
    LearningCardApplyTagSuggestionsRequest,
    LearningCardApplyTagSuggestionsResponse,
    LearningCardGenerateRequest,
    LearningCardGenerateResponse,
    LearningCardItem,
    LearningCardMaterialGenerateRequest,
    LearningCardMaterialItem,
    LearningCardTagSuggestion,
    LearningCardTagSuggestionRequest,
    LearningCardTagSuggestionResponse,
    LearningCardUpdateRequest,
    LearningCenterResponse,
    LearningReviewResponse,
    ProjectGuideResponse,
    ChatMessageItem,
    ReportDetail,
    ReportListItem,
    ReportStreamRequest,
    SettingsResponse,
    StaticAnalyzeRequest,
)
from backend.app.services.analyzer_service import scan_code
from backend.app.services.llm_service import LLMService, build_chat_fallback_title
from backend.app.services.prompt_service import (
    LANGUAGE_OPTIONS,
    MODEL_OPTIONS,
    REPORT_MODES,
    report_title,
    resolve_model,
)
from backend.app.services.sse import sse_event
from backend.app.services.usage_service import count_tokens, fetch_deepseek_balance, tokenizer_status


router = APIRouter(prefix="/api")

WORKSPACE_STALE_SECONDS = 20
_agent_workspace_snapshot: AgentWorkspaceSnapshot | None = None


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    mysql_ok, mysql_message = check_database()
    return HealthResponse(
        mysql_ok=mysql_ok,
        mysql_message=mysql_message,
        llm_key_configured=bool(settings.deepseek_api_key),
    )


@router.get("/settings", response_model=SettingsResponse)
def read_settings() -> SettingsResponse:
    mysql_ok, mysql_message = check_database()
    return SettingsResponse(
        models=MODEL_OPTIONS,
        default_model=settings.deepseek_default_model,
        default_model_label=settings.deepseek_default_model_label,
        languages=LANGUAGE_OPTIONS,
        default_language_label=settings.default_language_label,
        base_url=settings.deepseek_base_url,
        llm_key_configured=bool(settings.deepseek_api_key),
        mysql_ok=mysql_ok,
        mysql_message=mysql_message,
        report_modes=REPORT_MODES,
    )


@router.post("/analyze/static")
def analyze_static(payload: StaticAnalyzeRequest) -> dict:
    return scan_code(payload.code, payload.language_code)


@router.get("/ui/bootstrap")
def read_ui_bootstrap(session: Session = Depends(get_session)) -> dict:
    reports = list(
        session.exec(select(Report).order_by(Report.created_at.desc()).limit(6)).all()
    )
    chat_sessions = list(
        session.exec(select(ChatSession).order_by(ChatSession.updated_at.desc()).limit(6)).all()
    )
    agent_plans = list(
        session.exec(select(AgentPlan).order_by(AgentPlan.updated_at.desc()).limit(6)).all()
    )
    report_titles = _report_titles(session, {item.report_id for item in chat_sessions if item.report_id})

    return {
        "health": health().model_dump(),
        "settings": read_settings().model_dump(),
        "analytics_summary": _analytics_summary(session),
        "recent_reports": [_report_list_item(item).model_dump() for item in reports],
        "recent_chats": [
            _chat_session_item(item, report_titles.get(item.report_id or "")).model_dump()
            for item in chat_sessions
        ],
        "recent_agent_tasks": [_agent_plan_item(item).model_dump() for item in agent_plans],
    }


@router.get("/activity/recent")
def read_recent_activity(
    limit: int = Query(default=16, ge=1, le=50),
    session: Session = Depends(get_session),
) -> list[dict]:
    return _recent_activity(session, limit)


@router.get("/activity/constellation")
def read_activity_constellation(
    limit: int = Query(default=300, ge=1, le=300),
    session: Session = Depends(get_session),
) -> list[dict]:
    return _recent_activity(session, limit)


@router.get("/learning/center", response_model=LearningCenterResponse)
def read_learning_center(session: Session = Depends(get_session)) -> LearningCenterResponse:
    return _learning_center(session)


@router.get("/learning/cards", response_model=list[LearningCardItem])
def list_learning_cards(
    query: str | None = Query(default=None),
    status: str | None = Query(default=None),
    language_label: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[LearningCardItem]:
    statement = select(LearningCard).order_by(LearningCard.updated_at.desc())
    if status:
        statement = statement.where(LearningCard.status == status)
    if language_label:
        statement = statement.where(LearningCard.language_label == language_label)
    cards = list(session.exec(statement).all())
    if query:
        needle = query.lower()
        cards = [
            card for card in cards
            if needle in card.title.lower()
            or needle in card.explanation.lower()
            or any(needle in tag.lower() for tag in _safe_json_list(card.tags_json))
        ]
    return [_learning_card_item(item) for item in cards]


@router.post("/learning/cards", response_model=LearningCardItem)
def create_learning_card(
    payload: LearningCardCreateRequest,
    session: Session = Depends(get_session),
) -> LearningCardItem:
    title = payload.title.strip()[:160] or "未命名知识卡片"
    explanation = payload.explanation.strip() or "暂无说明"
    tags = _normalize_tags(payload.tags)
    resource_links = _normalize_resource_links(payload.resource_links)
    if not resource_links:
        resource_links = _recommended_learning_resources(title=title, language_label=payload.language_label, tags=tags)
    card = LearningCard(
        title=title,
        explanation=explanation,
        language_label=(payload.language_label or "通用")[:32],
        difficulty=_normalize_learning_difficulty(payload.difficulty),
        tags_json=json.dumps(tags, ensure_ascii=False),
        source_type=(payload.source_type or "manual")[:32],
        source_id=payload.source_id,
        code_excerpt=payload.code_excerpt,
        detail_markdown=payload.detail_markdown or _learning_card_detail(title, explanation, tags),
        notes=payload.notes,
        resource_links_json=json.dumps(resource_links, ensure_ascii=False),
        status=_normalize_learning_status(payload.status),
    )
    session.add(card)
    session.commit()
    session.refresh(card)
    return _learning_card_item(card)


@router.post("/learning/cards/bulk", response_model=LearningCardBulkCreateResponse)
def create_learning_cards_bulk(
    payload: LearningCardBulkCreateRequest,
    session: Session = Depends(get_session),
) -> LearningCardBulkCreateResponse:
    existing_keys = _existing_learning_card_keys(session)
    created_cards: list[LearningCard] = []
    skipped = 0

    for candidate in payload.cards[:12]:
        normalized = _normalize_learning_card_candidate(candidate, fallback_source_id=candidate.source_id)
        key = _learning_card_dedupe_key(normalized)
        if key in existing_keys:
            skipped += 1
            continue

        card = LearningCard(
            title=normalized.title,
            explanation=normalized.explanation,
            language_label=normalized.language_label,
            difficulty=normalized.difficulty,
            tags_json=json.dumps(normalized.tags, ensure_ascii=False),
            source_type=normalized.source_type,
            source_id=normalized.source_id,
            code_excerpt=normalized.code_excerpt,
            detail_markdown=normalized.detail_markdown or _learning_card_detail(
                normalized.title,
                normalized.explanation,
                normalized.tags,
            ),
            resource_links_json=json.dumps(normalized.resource_links, ensure_ascii=False),
            status="new",
        )
        session.add(card)
        created_cards.append(card)
        existing_keys.add(key)

    session.commit()
    for card in created_cards:
        session.refresh(card)

    return LearningCardBulkCreateResponse(
        created=len(created_cards),
        skipped=skipped,
        cards=[_learning_card_item(item) for item in created_cards],
    )


@router.patch("/learning/cards/{card_id}", response_model=LearningCardItem)
def update_learning_card(
    card_id: str,
    payload: LearningCardUpdateRequest,
    session: Session = Depends(get_session),
) -> LearningCardItem:
    card = session.get(LearningCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Learning card not found")
    if payload.title is not None:
        card.title = payload.title.strip()[:160] or card.title
    if payload.explanation is not None:
        card.explanation = payload.explanation.strip() or card.explanation
    if payload.language_label is not None:
        card.language_label = (payload.language_label or "通用")[:32]
    if payload.difficulty is not None:
        card.difficulty = _normalize_learning_difficulty(payload.difficulty)
    if payload.tags is not None:
        card.tags_json = json.dumps(_normalize_tags(payload.tags), ensure_ascii=False)
    if payload.code_excerpt is not None:
        card.code_excerpt = payload.code_excerpt
    if payload.detail_markdown is not None:
        card.detail_markdown = payload.detail_markdown
    if payload.notes is not None:
        card.notes = payload.notes
    if payload.resource_links is not None:
        resource_links = _normalize_resource_links(payload.resource_links)
        if not resource_links:
            resource_links = _recommended_learning_resources(card, title=card.title, language_label=card.language_label, tags=_safe_json_list(card.tags_json))
        card.resource_links_json = json.dumps(resource_links, ensure_ascii=False)
    if payload.status is not None:
        card.status = _normalize_learning_status(payload.status)
        if card.status in {"reviewing", "mastered"}:
            card.last_reviewed_at = datetime.utcnow()
    card.updated_at = datetime.utcnow()
    session.add(card)
    session.commit()
    session.refresh(card)
    return _learning_card_item(card)


@router.delete("/learning/cards/{card_id}", response_model=DeleteResponse)
def delete_learning_card(card_id: str, session: Session = Depends(get_session)) -> DeleteResponse:
    card = session.get(LearningCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Learning card not found")
    session.delete(card)
    session.commit()
    return DeleteResponse(ok=True)


@router.get("/learning/cards/{card_id}/material", response_model=LearningCardMaterialItem)
def read_learning_card_material(card_id: str, session: Session = Depends(get_session)) -> LearningCardMaterialItem:
    card = session.get(LearningCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Learning card not found")
    material = _learning_card_material_for_card(session, card_id)
    if material:
        return _learning_card_material_item(card, material, cached=True)
    return _learning_card_material_placeholder(card)


@router.post("/learning/cards/{card_id}/material/generate", response_model=LearningCardMaterialItem)
def generate_learning_card_material(
    card_id: str,
    payload: LearningCardMaterialGenerateRequest,
    session: Session = Depends(get_session),
) -> LearningCardMaterialItem:
    card = session.get(LearningCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Learning card not found")
    tags = [str(item) for item in _safe_json_list(card.tags_json) if str(item).strip()]
    source_links = _normalize_resource_links(_safe_json_list(card.resource_links_json))
    if not source_links:
        source_links = _recommended_learning_resources(card, title=card.title, language_label=card.language_label, tags=tags)
    service = LLMService(payload.model)
    content = service.generate_learning_card_material(
        title=card.title,
        language_label=card.language_label,
        difficulty=card.difficulty,
        explanation=card.explanation,
        tags=tags,
        code_excerpt=card.code_excerpt,
        source_links=source_links,
    ).strip()
    if not content:
        content = _fallback_learning_card_material(card, tags)
    material = _learning_card_material_for_card(session, card_id)
    now = datetime.utcnow()
    if material:
        material.content_markdown = content
        material.source_links_json = json.dumps(source_links, ensure_ascii=False)
        material.model = service.model
        material.generated_at = now
        material.updated_at = now
    else:
        material = LearningCardMaterial(
            card_id=card.id,
            content_markdown=content,
            source_links_json=json.dumps(source_links, ensure_ascii=False),
            model=service.model,
            generated_at=now,
            updated_at=now,
        )
    session.add(material)
    session.commit()
    session.refresh(material)
    return _learning_card_material_item(card, material, cached=True)


@router.post("/learning/cards/generate", response_model=LearningCardGenerateResponse)
def generate_learning_cards(
    payload: LearningCardGenerateRequest,
    session: Session = Depends(get_session),
) -> LearningCardGenerateResponse:
    reports = list(session.exec(select(Report).order_by(Report.created_at.desc()).limit(payload.source_limit)).all())
    existing_keys = _existing_learning_card_keys(session)
    service: LLMService | None = None
    try:
        service = LLMService(payload.model)
    except Exception:
        service = None
    candidates: list[LearningCardCandidate] = []
    skipped = 0
    for report in reports:
        report_candidates = _learning_card_candidates_for_report(report, service=service)
        for candidate in report_candidates:
            key = _learning_card_dedupe_key(candidate)
            if key in existing_keys:
                skipped += 1
                continue
            candidates.append(candidate)
            existing_keys.add(key)
            if len(candidates) >= 24:
                break
        if len(candidates) >= 24:
            break
    return LearningCardGenerateResponse(
        created=0,
        skipped=skipped,
        cards=[],
        candidates=candidates,
    )


@router.post("/learning/cards/tag-suggestions", response_model=LearningCardTagSuggestionResponse)
def suggest_learning_card_tags(
    payload: LearningCardTagSuggestionRequest,
    session: Session = Depends(get_session),
) -> LearningCardTagSuggestionResponse:
    cards = list(session.exec(select(LearningCard).order_by(LearningCard.created_at.desc()).limit(payload.limit)).all())
    if not cards:
        return LearningCardTagSuggestionResponse(suggestions=[])
    service = LLMService(payload.model)
    try:
        raw_suggestions = service.suggest_learning_card_tags([_learning_card_tag_context(card) for card in cards])
    except Exception:
        raw_suggestions = _fallback_learning_card_tag_suggestions(cards)
    return LearningCardTagSuggestionResponse(
        suggestions=_normalize_tag_suggestions(raw_suggestions, {card.id for card in cards})
    )


@router.post("/learning/cards/apply-tag-suggestions", response_model=LearningCardApplyTagSuggestionsResponse)
def apply_learning_card_tag_suggestions(
    payload: LearningCardApplyTagSuggestionsRequest,
    session: Session = Depends(get_session),
) -> LearningCardApplyTagSuggestionsResponse:
    updated_ids: set[str] = set()
    for suggestion in _normalize_tag_suggestions([item.model_dump() for item in payload.suggestions], set()):
        if not suggestion.card_ids:
            continue
        cards = list(session.exec(select(LearningCard).where(LearningCard.id.in_(suggestion.card_ids))).all())
        for card in cards:
            current_tags = [str(item) for item in _safe_json_list(card.tags_json)]
            next_tags = _apply_tag_suggestion_to_tags(current_tags, suggestion)
            if next_tags == current_tags:
                continue
            card.tags_json = json.dumps(next_tags, ensure_ascii=False)
            card.updated_at = datetime.utcnow()
            session.add(card)
            updated_ids.add(card.id)
    session.commit()
    refreshed = [session.get(LearningCard, card_id) for card_id in updated_ids]
    return LearningCardApplyTagSuggestionsResponse(
        updated=len(updated_ids),
        cards=[_learning_card_item(card) for card in refreshed if card],
    )


@router.get("/learning/project-guide", response_model=ProjectGuideResponse)
def read_project_guide(session: Session = Depends(get_session)) -> ProjectGuideResponse:
    return _project_guide(session)


@router.get("/learning/review", response_model=LearningReviewResponse)
def read_learning_review(
    period: str = Query(default="week", pattern="^(week|month|all)$"),
    session: Session = Depends(get_session),
) -> LearningReviewResponse:
    return _learning_review(session, period)


@router.get("/daily-logs/calendar", response_model=list[DailyWorkLogCalendarItem])
def list_daily_work_log_calendar(
    days: int = Query(default=30, ge=7, le=120),
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    session: Session = Depends(get_session),
) -> list[DailyWorkLogCalendarItem]:
    if month:
        year, month_number = [int(part) for part in month.split("-")]
        start = date(year, month_number, 1)
        end = date(year + 1, 1, 1) - timedelta(days=1) if month_number == 12 else date(year, month_number + 1, 1) - timedelta(days=1)
        logs = _daily_logs_by_date(session, start, end)
        total_days = (end - start).days + 1
        return [
            _daily_calendar_item(session, current, logs.get(current))
            for current in (start + timedelta(days=offset) for offset in range(total_days))
        ]
    today = date.today()
    start = today - timedelta(days=days - 1)
    logs = _daily_logs_by_date(session, start, today)
    return [
        _daily_calendar_item(session, current, logs.get(current))
        for current in (today - timedelta(days=offset) for offset in range(days))
    ]


@router.get("/daily-logs/{log_date}", response_model=DailyWorkLogItem)
def read_daily_work_log(log_date: str, session: Session = Depends(get_session)) -> DailyWorkLogItem:
    day = _parse_log_date(log_date)
    log = _daily_log_for_date(session, day)
    return _daily_work_log_item(session, day, log)


@router.post("/daily-logs/{log_date}/generate", response_model=DailyWorkLogItem)
def generate_daily_work_log(
    log_date: str,
    payload: DailyWorkLogGenerateRequest,
    session: Session = Depends(get_session),
) -> DailyWorkLogItem:
    day = _parse_log_date(log_date)
    context = _daily_work_context(session, day)
    if not context["stats"]["total_activity"]:
        raise HTTPException(status_code=400, detail="这一天还没有可总结的使用记录。")
    service = LLMService(payload.model)
    content = service.generate_daily_work_log(
        log_date=day.isoformat(),
        context_markdown=context["context_markdown"],
        stats=context["stats"],
    ).strip()
    if not content:
        content = _fallback_daily_work_log(day, context["stats"])
    title = _daily_log_title(day, content)
    existing = _daily_log_for_date(session, day)
    now = datetime.utcnow()
    if existing:
        existing.title = title
        existing.content_markdown = content
        existing.source_stats_json = json.dumps(context["stats"], ensure_ascii=False)
        existing.source_refs_json = json.dumps(context["refs"], ensure_ascii=False)
        existing.model = service.model
        existing.generated_at = now
        existing.updated_at = now
        log = existing
    else:
        log = DailyWorkLog(
            log_date=_day_start(day),
            title=title,
            content_markdown=content,
            source_stats_json=json.dumps(context["stats"], ensure_ascii=False),
            source_refs_json=json.dumps(context["refs"], ensure_ascii=False),
            model=service.model,
            generated_at=now,
            updated_at=now,
        )
    session.add(log)
    session.commit()
    session.refresh(log)
    return _daily_work_log_item(session, day, log)


@router.patch("/daily-logs/{log_date}", response_model=DailyWorkLogItem)
def update_daily_work_log(
    log_date: str,
    payload: DailyWorkLogUpdateRequest,
    session: Session = Depends(get_session),
) -> DailyWorkLogItem:
    day = _parse_log_date(log_date)
    log = _daily_log_for_date(session, day)
    title = payload.title.strip()[:160] if payload.title is not None else ""
    content = payload.content_markdown.strip() if payload.content_markdown is not None else ""
    if not log:
        if not content:
            raise HTTPException(status_code=400, detail="日志正文不能为空。")
        stats = _daily_activity_stats(session, day)
        now = datetime.utcnow()
        log = DailyWorkLog(
            log_date=_day_start(day),
            title=title or f"{day.isoformat()} 日记",
            content_markdown=content,
            source_stats_json=json.dumps(stats, ensure_ascii=False),
            source_refs_json="[]",
            model=None,
            generated_at=now,
            updated_at=now,
        )
        session.add(log)
        session.commit()
        session.refresh(log)
        return _daily_work_log_item(session, day, log)
    if payload.title is not None:
        log.title = title or log.title
    if payload.content_markdown is not None:
        if not content:
            raise HTTPException(status_code=400, detail="日志正文不能为空。")
        log.content_markdown = content
    log.updated_at = datetime.utcnow()
    session.add(log)
    session.commit()
    session.refresh(log)
    return _daily_work_log_item(session, day, log)


@router.post("/agent/workspace/heartbeat", response_model=AgentWorkspaceSnapshot)
def update_agent_workspace_heartbeat(payload: AgentWorkspaceHeartbeatRequest) -> AgentWorkspaceSnapshot:
    global _agent_workspace_snapshot
    now = datetime.utcnow()
    _agent_workspace_snapshot = AgentWorkspaceSnapshot(
        **payload.model_dump(),
        connected=True,
        stale=False,
        updated_at=now,
    )
    return _agent_workspace_snapshot


@router.get("/agent/workspace/current", response_model=AgentWorkspaceSnapshot)
def read_current_agent_workspace() -> AgentWorkspaceSnapshot:
    return _workspace_snapshot_response(_agent_workspace_snapshot)


@router.post("/agent/context/select", response_model=AgentContextSelectResponse)
def select_agent_context(payload: AgentContextSelectRequest) -> AgentContextSelectResponse:
    mysql_ok, mysql_message = check_database()
    if not mysql_ok:
        raise HTTPException(status_code=503, detail=f"MySQL not connected: {mysql_message}")

    selected_seed = _normalize_selected_file_paths(payload.selected_file_paths)
    if payload.context_mode == "manual":
        return AgentContextSelectResponse(
            selected_file_paths=selected_seed,
            reasons=[{"path": item, "reason": "用户手动选择"} for item in selected_seed],
            skipped=[],
        )

    service = LLMService(payload.model)
    result = service.select_agent_context_files(
        instruction=payload.instruction,
        context_mode=payload.context_mode,
        selected_file_paths=selected_seed,
        candidates=[item.model_dump() for item in payload.candidates],
    )
    selected_paths = _normalize_selected_file_paths([str(item) for item in result.get("selected_file_paths", [])])
    if payload.context_mode == "hybrid":
        selected_paths = _normalize_selected_file_paths([*selected_seed, *selected_paths])

    allowed_paths = {item.path.replace("\\", "/") for item in payload.candidates}
    selected_paths = [item for item in selected_paths if item in allowed_paths][:20]
    reason_map = {
        str(item.get("path") or "").replace("\\", "/"): str(item.get("reason") or "").strip()
        for item in result.get("reasons", [])
        if isinstance(item, dict)
    }
    reasons = [
        {
            "path": path,
            "reason": reason_map.get(path) or ("用户手动选择" if path in selected_seed else "AI 判断与任务相关"),
        }
        for path in selected_paths
    ]
    skipped = [
        {
            "path": str(item.get("path") or "").replace("\\", "/")[:500],
            "reason": str(item.get("reason") or "").strip()[:240],
        }
        for item in result.get("skipped", [])
        if isinstance(item, dict) and str(item.get("path") or "").strip()
    ][:20]
    return AgentContextSelectResponse(selected_file_paths=selected_paths, reasons=reasons, skipped=skipped)


@router.post("/agent/plan", response_model=AgentPlanResponse)
def plan_agent(payload: AgentPlanRequest) -> AgentPlanResponse:
    mysql_ok, mysql_message = check_database()
    if not mysql_ok:
        raise HTTPException(status_code=503, detail=f"MySQL not connected: {mysql_message}")
    if payload.agent_action == "chat":
        raise HTTPException(status_code=400, detail="Agent chat must use /api/agent/chat/stream")

    created_session = False
    existing_plan_id: str | None = None
    with Session(engine) as session:
        existing_plan = session.get(AgentPlan, payload.task_id) if payload.task_id else None
        if existing_plan:
            chat_session = session.get(ChatSession, existing_plan.session_id)
            if not chat_session or chat_session.context_type != "agent":
                raise HTTPException(status_code=404, detail="Agent task session not found")
            instruction = payload.instruction or existing_plan.instruction
            existing_plan_id = existing_plan.id
        else:
            chat_session = session.get(ChatSession, payload.session_id) if payload.session_id else None
            if chat_session and chat_session.context_type != "agent":
                chat_session = None
            instruction = payload.instruction

        if not chat_session:
            title = _ensure_unique_title(
                session,
                ChatSession,
                build_chat_fallback_title(instruction, "", "Agent task"),
            )
            chat_session = ChatSession(title=title, context_type="agent")
            session.add(chat_session)
            session.flush()
            created_session = True

        if payload.defer_to_plugin and payload.source == "web" and not existing_plan:
            selected_file_paths = _normalize_selected_file_paths(payload.selected_file_paths)
            session.add(ChatMessage(session_id=chat_session.id, role="user", content=instruction))
            plan_row = AgentPlan(
                session_id=chat_session.id,
                instruction=instruction,
                summary="等待 VS Code 插件处理",
                assumptions_json=json.dumps([], ensure_ascii=False),
                warnings_json=json.dumps(["打开 VS Code 插件后会读取工作区文件并生成可确认的修改计划。"], ensure_ascii=False),
                operations_json=json.dumps([], ensure_ascii=False),
                selected_files_json=json.dumps(selected_file_paths, ensure_ascii=False),
                context_mode=payload.context_mode,
                status="pending",
                source="web",
                apply_result="任务已保存，等待 VS Code 插件处理。",
            )
            session.add(plan_row)
            session.flush()
            assistant_message = _agent_plan_message(plan_row)
            session.add(ChatMessage(session_id=chat_session.id, role="assistant", content=assistant_message))
            if created_session:
                chat_session.title = _ensure_unique_title(
                    session,
                    ChatSession,
                    build_chat_fallback_title(instruction, assistant_message, "Agent 任务"),
                    chat_session.id,
                )
            chat_session.updated_at = datetime.utcnow()
            session.add(chat_session)
            session.commit()
            session.refresh(plan_row)
            return AgentPlanResponse(
                session_id=chat_session.id,
                plan_id=plan_row.id,
                title=chat_session.title,
                status=plan_row.status,
                source=plan_row.source,
                summary=plan_row.summary,
                assumptions=_safe_json_list(plan_row.assumptions_json),
                warnings=_safe_json_list(plan_row.warnings_json),
                operations=_safe_json_list(plan_row.operations_json),
                selected_file_paths=_selected_file_paths(plan_row),
                context_mode=_context_mode(plan_row),
            )

        history_rows = list(
            session.exec(
                select(ChatMessage)
                .where(ChatMessage.session_id == chat_session.id)
                .order_by(ChatMessage.created_at)
                .limit(20)
            ).all()
        )
        history = [
            {"role": item.role, "content": item.content}
            for item in history_rows
            if item.role in {"user", "assistant"}
        ]

        previous_plan_rows = list(
            session.exec(
                select(AgentPlan)
                .where(AgentPlan.session_id == chat_session.id)
                .order_by(AgentPlan.created_at)
                .limit(10)
            ).all()
        )
        previous_plans = [
            {
                "summary": item.summary,
                "status": item.status,
                "source": item.source,
                "operations": _safe_json_list(item.operations_json),
            }
            for item in previous_plan_rows
        ]

        if not existing_plan:
            session.add(ChatMessage(session_id=chat_session.id, role="user", content=instruction))
        chat_session.updated_at = datetime.utcnow()
        session.add(chat_session)
        session.commit()
        session_id = chat_session.id

    service = LLMService(payload.model)
    plan = service.generate_agent_plan(
        instruction=instruction,
        code_context=payload.code_context,
        language_code=payload.language_code,
        language_label=payload.language_label,
        file_name=payload.file_name,
        file_path=payload.file_path,
        report_context=payload.report_context,
        files=[item.model_dump() for item in payload.files],
        history=history,
        previous_plans=previous_plans,
    )

    with Session(engine) as session:
        chat_session = session.get(ChatSession, session_id)
        if not chat_session:
            raise HTTPException(status_code=404, detail="Agent session not found")

        source = payload.source if payload.source in {"web", "plugin"} else "plugin"
        plan_row = session.get(AgentPlan, existing_plan_id) if existing_plan_id else None
        if plan_row:
            source = plan_row.source or source
            plan_row.instruction = instruction
            plan_row.summary = str(plan.get("summary") or "").strip()[:500]
            plan_row.assumptions_json = json.dumps(plan.get("assumptions", []), ensure_ascii=False)
            plan_row.warnings_json = json.dumps(plan.get("warnings", []), ensure_ascii=False)
            plan_row.operations_json = json.dumps(plan.get("operations", []), ensure_ascii=False)
            if payload.selected_file_paths:
                plan_row.selected_files_json = json.dumps(_normalize_selected_file_paths(payload.selected_file_paths), ensure_ascii=False)
            plan_row.context_mode = payload.context_mode
            plan_row.status = "waiting_confirm" if source == "web" else "pending"
            plan_row.source = source
            plan_row.apply_result = "网页已确认前的插件计划，等待下一步处理。" if source == "web" else "VS Code 插件已生成计划，等待用户确认应用。"
            plan_row.updated_at = datetime.utcnow()
        else:
            plan_row = AgentPlan(
                session_id=session_id,
                instruction=instruction,
                summary=str(plan.get("summary") or "").strip()[:500],
                assumptions_json=json.dumps(plan.get("assumptions", []), ensure_ascii=False),
                warnings_json=json.dumps(plan.get("warnings", []), ensure_ascii=False),
                operations_json=json.dumps(plan.get("operations", []), ensure_ascii=False),
                selected_files_json=json.dumps(_normalize_selected_file_paths(payload.selected_file_paths), ensure_ascii=False),
                context_mode=payload.context_mode,
                status="pending",
                source=source,
            )
        session.add(plan_row)
        session.flush()

        assistant_message = _agent_plan_message(plan_row)
        session.add(ChatMessage(session_id=session_id, role="assistant", content=assistant_message))
        if created_session:
            chat_session.title = _ensure_unique_title(
                session,
                ChatSession,
                _safe_chat_title(service, instruction, assistant_message, chat_session.title),
                chat_session.id,
            )
        chat_session.updated_at = datetime.utcnow()
        session.add(chat_session)
        session.commit()
        session.refresh(plan_row)
        title = chat_session.title

    return AgentPlanResponse(
        session_id=session_id,
        plan_id=plan_row.id,
        title=title,
        status=plan_row.status,
        source=plan_row.source,
        summary=plan_row.summary,
        assumptions=_safe_json_list(plan_row.assumptions_json),
        warnings=_safe_json_list(plan_row.warnings_json),
        operations=_safe_json_list(plan_row.operations_json),
        selected_file_paths=_selected_file_paths(plan_row),
        context_mode=_context_mode(plan_row),
    )


@router.post("/agent/chat/stream")
def stream_agent_chat(payload: AgentChatStreamRequest) -> StreamingResponse:
    def event_generator():
        chunks: list[str] = []
        try:
            mysql_ok, mysql_message = check_database()
            if not mysql_ok:
                yield sse_event("error", _mysql_error_payload(mysql_message))
                return

            created_session = False
            with Session(engine) as session:
                chat_session = session.get(ChatSession, payload.session_id) if payload.session_id else None
                if chat_session and chat_session.context_type != "agent":
                    chat_session = None
                if not chat_session:
                    title = _ensure_unique_title(
                        session,
                        ChatSession,
                        build_chat_fallback_title(payload.message, "", "Agent 对话"),
                    )
                    chat_session = ChatSession(title=title, context_type="agent")
                    session.add(chat_session)
                    session.flush()
                    created_session = True

                history_rows = list(
                    session.exec(
                        select(ChatMessage)
                        .where(ChatMessage.session_id == chat_session.id)
                        .order_by(ChatMessage.created_at)
                        .limit(24)
                    ).all()
                )
                history = [
                    {"role": item.role, "content": item.content}
                    for item in history_rows
                    if item.role in {"user", "assistant"}
                ]
                session.add(ChatMessage(session_id=chat_session.id, role="user", content=payload.message))
                chat_session.updated_at = datetime.utcnow()
                session.add(chat_session)
                session.commit()
                session_id = chat_session.id

            service = LLMService(payload.model)
            for text in service.stream_agent_chat(
                payload.message,
                history,
                code_context=payload.code_context,
                report_context=payload.report_context,
                files=[item.model_dump() for item in payload.files],
            ):
                chunks.append(text)
                yield sse_event("delta", {"text": text})

            reply = "".join(chunks).strip()
            final_session_title = None
            with Session(engine) as session:
                chat_session = session.get(ChatSession, session_id)
                if chat_session:
                    session.add(ChatMessage(session_id=session_id, role="assistant", content=reply))
                    if created_session:
                        chat_session.title = _ensure_unique_title(
                            session,
                            ChatSession,
                            _safe_chat_title(service, payload.message, reply, chat_session.title),
                            chat_session.id,
                        )
                    chat_session.updated_at = datetime.utcnow()
                    session.add(chat_session)
                    session.commit()
                    final_session_title = chat_session.title
                yield sse_event("done", {"session_id": session_id, "title": final_session_title})
        except Exception as exc:
            yield sse_event("error", _llm_error_payload(exc))

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


@router.get("/agent/pending", response_model=list[AgentPlanItem])
def list_pending_agent_tasks(
    limit: int = Query(default=20, ge=1, le=50),
    session: Session = Depends(get_session),
) -> list[AgentPlanItem]:
    plans = list(
        session.exec(
            select(AgentPlan)
            .where(AgentPlan.source == "web")
            .where(AgentPlan.status == "pending")
            .order_by(AgentPlan.updated_at.desc())
            .limit(limit)
        ).all()
    )
    return [_agent_plan_item(item) for item in plans]


@router.get("/agent/confirmed", response_model=list[AgentPlanItem])
def list_confirmed_agent_tasks(
    limit: int = Query(default=20, ge=1, le=50),
    session: Session = Depends(get_session),
) -> list[AgentPlanItem]:
    plans = list(
        session.exec(
            select(AgentPlan)
            .where(AgentPlan.status == "confirmed")
            .order_by(AgentPlan.updated_at.desc())
            .limit(limit)
        ).all()
    )
    return [_agent_plan_item(item) for item in plans]


@router.post("/agent/tasks/{task_id}/result", response_model=AgentPlanItem)
def update_agent_task_result(
    task_id: str,
    payload: AgentTaskResultRequest,
    session: Session = Depends(get_session),
) -> AgentPlanItem:
    plan = session.get(AgentPlan, task_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Agent task not found")

    if payload.summary is not None:
        plan.summary = payload.summary[:500]
    if payload.assumptions:
        plan.assumptions_json = json.dumps(payload.assumptions, ensure_ascii=False)
    if payload.warnings:
        plan.warnings_json = json.dumps(payload.warnings, ensure_ascii=False)
    if payload.operations:
        plan.operations_json = json.dumps([item.model_dump() for item in payload.operations], ensure_ascii=False)
    plan.status = payload.status[:24]
    plan.apply_result = payload.message
    plan.updated_at = datetime.utcnow()
    session.add(plan)

    chat_session = session.get(ChatSession, plan.session_id)
    if chat_session:
        if payload.message:
            session.add(ChatMessage(session_id=chat_session.id, role="assistant", content=payload.message))
        chat_session.updated_at = datetime.utcnow()
        session.add(chat_session)

    session.commit()
    session.refresh(plan)
    return _agent_plan_item(plan)


@router.post("/agent/plans/{plan_id}/apply-result", response_model=AgentPlanItem)
def update_agent_plan_apply_result(
    plan_id: str,
    payload: AgentApplyResultRequest,
    session: Session = Depends(get_session),
) -> AgentPlanItem:
    plan = session.get(AgentPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Agent plan not found")

    plan.status = payload.status
    plan.apply_result = payload.message
    plan.updated_at = datetime.utcnow()
    session.add(plan)

    chat_session = session.get(ChatSession, plan.session_id)
    if chat_session:
        chat_session.updated_at = datetime.utcnow()
        session.add(chat_session)

    session.commit()
    session.refresh(plan)
    return _agent_plan_item(plan)


@router.post("/agent/plans/{plan_id}/confirm", response_model=AgentPlanItem)
def confirm_agent_plan(
    plan_id: str,
    payload: AgentConfirmRequest,
    session: Session = Depends(get_session),
) -> AgentPlanItem:
    plan = session.get(AgentPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Agent plan not found")

    operations = _safe_json_list(plan.operations_json)
    if payload.action == "apply" and not operations:
        raise HTTPException(status_code=400, detail="Agent plan has no operations to apply")

    if payload.action == "reject":
        plan.status = "rejected"
        plan.apply_result = payload.message or "Web 用户拒绝应用 Agent 计划。"
    else:
        plan.status = "confirmed"
        plan.apply_result = payload.message or "Web 用户已确认应用，等待 VS Code 插件执行。"

    plan.updated_at = datetime.utcnow()
    session.add(plan)

    chat_session = session.get(ChatSession, plan.session_id)
    if chat_session:
        session.add(ChatMessage(session_id=chat_session.id, role="assistant", content=plan.apply_result or ""))
        chat_session.updated_at = datetime.utcnow()
        session.add(chat_session)

    session.commit()
    session.refresh(plan)
    return _agent_plan_item(plan)


def _save_metric(session: Session, report_id: str, metrics: dict) -> None:
    functions = metrics.get("functions", {}) or {}
    metric = AnalysisMetric(
        report_id=report_id,
        lines=int(metrics.get("lines", 0) or 0),
        functions_count=int(functions.get("count", 0) or 0),
        functions_json=json.dumps(functions, ensure_ascii=False),
        secrets_json=json.dumps(metrics.get("secrets_risk", []), ensure_ascii=False),
    )
    session.add(metric)


def _stream_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


def _chat_report_context(report: Report) -> tuple[str, str]:
    if report.report_type == "diff":
        code_context = (
            f"版本 A：\n```\n{report.code_a or ''}\n```\n\n"
            f"版本 B：\n```\n{report.code_b or ''}\n```"
        )
    else:
        code_context = report.code_content or ""
    return code_context, report.content


def _chat_session_item(session: ChatSession, report_title: str | None = None) -> ChatSessionListItem:
    return ChatSessionListItem(
        id=session.id,
        title=session.title,
        context_type=session.context_type,
        report_id=session.report_id,
        report_title=report_title,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def _report_list_item(report: Report) -> ReportListItem:
    return ReportListItem(
        id=report.id,
        title=report.title,
        report_type=report.report_type,
        mode=report.mode,
        language_label=report.language_label,
        language_code=report.language_code,
        model=report.model,
        created_at=report.created_at,
    )


def _safe_json_list(value: str | None) -> list:
    if not value:
        return []
    try:
        data = json.loads(value)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _normalize_selected_file_paths(paths: list[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw_path in paths or []:
        normalized = str(raw_path or "").strip().replace("\\", "/")
        while normalized.startswith("./"):
            normalized = normalized[2:]
        if (
            not normalized
            or normalized.startswith("/")
            or normalized.startswith("../")
            or "/../" in normalized
            or ":" in normalized
        ):
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized[:500])
        if len(result) >= 20:
            break
    return result


def _selected_file_paths(plan: AgentPlan) -> list[str]:
    return _normalize_selected_file_paths([str(item) for item in _safe_json_list(plan.selected_files_json)])


def _context_mode(plan: AgentPlan) -> str:
    value = str(getattr(plan, "context_mode", "") or "manual")
    return value if value in {"manual", "ai_auto", "hybrid"} else "manual"


def _normalize_tags(tags: list[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in tags or []:
        tag = str(raw or "").strip().strip("#")[:32]
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(tag)
        if len(result) >= 8:
            break
    return result


def _normalize_learning_difficulty(value: str | None) -> str:
    normalized = str(value or "").strip()
    return normalized if normalized in {"入门", "进阶", "面试", "项目"} else "入门"


def _normalize_learning_status(value: str | None) -> str:
    normalized = str(value or "").strip()
    return normalized if normalized in {"new", "reviewing", "mastered", "bookmarked"} else "new"


def _learning_card_dedupe_key(candidate: LearningCardCandidate) -> tuple[str, str, str]:
    return (
        candidate.title.strip().lower(),
        candidate.language_label.strip().lower(),
        candidate.source_id or "",
    )


def _existing_learning_card_keys(session: Session) -> set[tuple[str, str, str]]:
    return {
        (card.title.strip().lower(), card.language_label.strip().lower(), card.source_id or "")
        for card in session.exec(select(LearningCard)).all()
    }


def _normalize_learning_card_candidate(
    value: LearningCardCandidate | dict,
    *,
    fallback_language_label: str = "通用",
    fallback_source_id: str | None = None,
    fallback_source_title: str | None = None,
) -> LearningCardCandidate:
    data = value.model_dump() if isinstance(value, LearningCardCandidate) else dict(value or {})
    raw_tags = data.get("tags")
    tags = [str(item) for item in raw_tags] if isinstance(raw_tags, list) else []
    title = str(data.get("title") or "").strip()[:160] or "未命名知识点"
    explanation = str(data.get("explanation") or data.get("summary") or "").strip()
    if not explanation:
        explanation = f"{title} 是这份报告中值得单独复习的编程知识点。"
    language_label = str(data.get("language_label") or fallback_language_label or "通用").strip()[:32] or "通用"
    normalized_tags = _normalize_tags([language_label, *tags])
    source_type = str(data.get("source_type") or "report").strip()[:32] or "report"
    source_id = str(data.get("source_id") or fallback_source_id or "").strip() or None
    code_excerpt = str(data.get("code_excerpt") or "").strip()[:2600] or None
    detail_markdown = str(data.get("detail_markdown") or "").strip()[:5000]
    if not detail_markdown:
        detail_markdown = _learning_card_detail(title, explanation, normalized_tags, fallback_source_title)
    resources = _normalize_resource_links(data.get("resource_links") if isinstance(data.get("resource_links"), list) else None)
    if not resources:
        resources = _recommended_learning_resources(title=title, language_label=language_label, tags=normalized_tags)
    source_reason = str(data.get("source_reason") or "").strip()[:360] or None
    confidence_value = data.get("confidence")
    try:
        confidence = float(confidence_value) if confidence_value is not None else None
    except (TypeError, ValueError):
        confidence = None
    if confidence is not None:
        confidence = max(0.0, min(1.0, confidence))

    return LearningCardCandidate(
        title=title,
        explanation=explanation[:1200],
        language_label=language_label,
        difficulty=_normalize_learning_difficulty(str(data.get("difficulty") or "入门")),
        tags=normalized_tags,
        source_type=source_type,
        source_id=source_id,
        code_excerpt=code_excerpt,
        detail_markdown=detail_markdown,
        resource_links=resources,
        source_reason=source_reason,
        confidence=confidence,
    )


LEARNING_RESOURCE_LIBRARY = [
    {
        "title": "Python 官方教程",
        "url": "https://docs.python.org/3/tutorial/",
        "description": "适合系统补齐 Python 语法、模块和常见编程概念。",
        "keywords": ["python", "函数", "变量", "循环", "异常处理", "模块", "文件操作", "装饰器", "上下文管理器", "列表推导式", "字典推导式"],
    },
    {
        "title": "MDN JavaScript Guide",
        "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
        "description": "覆盖 JavaScript 基础、对象、函数、异步和浏览器编程。",
        "keywords": ["javascript", "js", "函数", "变量", "异步", "对象", "条件判断", "循环"],
    },
    {
        "title": "TypeScript Handbook",
        "url": "https://www.typescriptlang.org/docs/handbook/intro.html",
        "description": "适合复习类型系统、接口、泛型和大型前端项目中的类型设计。",
        "keywords": ["typescript", "ts", "类型", "接口", "组件", "状态管理"],
    },
    {
        "title": "React Learn",
        "url": "https://react.dev/learn",
        "description": "围绕组件、状态、事件和 Hooks 建立现代 React 学习路径。",
        "keywords": ["react", "组件", "状态管理", "hook", "hooks", "tsx"],
    },
    {
        "title": "FastAPI Tutorial",
        "url": "https://fastapi.tiangolo.com/tutorial/",
        "description": "适合理解后端接口、请求参数、响应模型和 API 项目结构。",
        "keywords": ["fastapi", "api", "后端接口", "路径校验", "python"],
    },
    {
        "title": "SQLAlchemy Tutorial",
        "url": "https://docs.sqlalchemy.org/en/20/tutorial/",
        "description": "辅助理解数据库模型、查询、事务和 ORM 基础。",
        "keywords": ["sqlalchemy", "数据库", "orm", "mysql"],
    },
    {
        "title": "Pro Git",
        "url": "https://git-scm.com/book/en/v2",
        "description": "适合补齐 Git、分支、提交和协作开发基础。",
        "keywords": ["git", "版本控制", "分支", "提交"],
    },
    {
        "title": "VS Code Extension API",
        "url": "https://code.visualstudio.com/api",
        "description": "用于理解 VS Code 插件能力、命令、Webview 与扩展通信。",
        "keywords": ["vscode", "vs code", "插件", "extension", "webview"],
    },
]


def _normalize_resource_links(value: list[dict[str, str]] | None) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for item in value or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:80]
        url = str(item.get("url") or "").strip()
        description = str(item.get("description") or "").strip()[:180]
        if not title or not url.startswith(("https://", "http://")):
            continue
        normalized = {"title": title, "url": url, "description": description}
        if normalized not in result:
            result.append(normalized)
        if len(result) >= 6:
            break
    return result


def _recommended_learning_resources(card: LearningCard | None = None, *, title: str = "", language_label: str = "", tags: list[str] | None = None) -> list[dict[str, str]]:
    haystack = " ".join([title, language_label, *(tags or [])]).lower()
    matched: list[dict[str, str]] = []
    for resource in LEARNING_RESOURCE_LIBRARY:
        if any(keyword.lower() in haystack for keyword in resource["keywords"]):
            matched.append({key: str(resource[key]) for key in ["title", "url", "description"]})
    if not matched:
        matched = [
            {key: str(LEARNING_RESOURCE_LIBRARY[0][key]) for key in ["title", "url", "description"]},
            {key: str(LEARNING_RESOURCE_LIBRARY[6][key]) for key in ["title", "url", "description"]},
        ]
    return matched[:4]


def _learning_card_detail(title: str, explanation: str, tags: list[str], source_title: str | None = None) -> str:
    tag_text = "、".join(tags[:4]) if tags else "基础语法与项目实践"
    source_text = f"\n\n来源：{source_title}" if source_title else ""
    return (
        f"## {title}\n\n"
        f"{explanation}\n\n"
        f"### 适用场景\n"
        f"- 当代码或报告中反复出现“{title}”时，可以用它来定位理解盲区。\n"
        f"- 结合真实代码观察它和 {tag_text} 的关系。\n\n"
        f"### 常见误区\n"
        f"- 只记住概念名称，没有回到具体代码中看输入、输出和边界情况。\n"
        f"- 忽略报错信息、调用位置或数据流，导致复习停留在表面。"
        f"{source_text}"
    )


def _learning_card_item(card: LearningCard) -> LearningCardItem:
    tags = [str(item) for item in _safe_json_list(card.tags_json) if str(item).strip()]
    resources = _normalize_resource_links(_safe_json_list(card.resource_links_json))
    if not resources:
        resources = _recommended_learning_resources(card, title=card.title, language_label=card.language_label, tags=tags)
    return LearningCardItem(
        id=card.id,
        title=card.title,
        explanation=card.explanation,
        language_label=card.language_label,
        difficulty=card.difficulty,
        tags=tags,
        source_type=card.source_type,
        source_id=card.source_id,
        code_excerpt=card.code_excerpt,
        detail_markdown=card.detail_markdown,
        notes=card.notes,
        resource_links=resources,
        status=card.status,
        last_reviewed_at=card.last_reviewed_at,
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def _learning_card_tag_context(card: LearningCard) -> dict:
    return {
        "id": card.id,
        "title": card.title,
        "explanation": card.explanation,
        "language_label": card.language_label,
        "difficulty": card.difficulty,
        "tags": [str(item) for item in _safe_json_list(card.tags_json) if str(item).strip()],
        "status": card.status,
    }


def _normalize_tag_suggestions(raw_suggestions: list[dict], allowed_card_ids: set[str]) -> list[LearningCardTagSuggestion]:
    suggestions: list[LearningCardTagSuggestion] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_suggestions or []):
        if not isinstance(raw, dict):
            continue
        action = str(raw.get("action") or "").strip().lower()
        if action not in {"merge", "add", "remove", "rename"}:
            continue
        card_ids = [str(item).strip() for item in raw.get("card_ids", []) if str(item).strip()]
        if allowed_card_ids:
            card_ids = [card_id for card_id in card_ids if card_id in allowed_card_ids]
        from_tags = _normalize_tags([str(item) for item in raw.get("from_tags", [])])
        to_tags = _normalize_tags([str(item) for item in raw.get("to_tags", [])])
        if action in {"merge", "rename"} and (not from_tags or not to_tags):
            continue
        if action == "add" and not to_tags:
            continue
        if action == "remove" and not from_tags:
            continue
        if not card_ids and action == "add":
            continue
        title = str(raw.get("title") or "").strip()[:120] or _tag_suggestion_title(action, from_tags, to_tags)
        reason = str(raw.get("reason") or "").strip()[:360] or "AI 建议整理这组标签，用户确认后才会应用。"
        key = f"{action}|{','.join(card_ids)}|{','.join(from_tags)}|{','.join(to_tags)}".lower()
        if key in seen:
            continue
        seen.add(key)
        suggestions.append(
            LearningCardTagSuggestion(
                id=str(raw.get("id") or f"suggestion-{index + 1}")[:80],
                action=action,
                title=title,
                reason=reason,
                card_ids=card_ids[:60],
                from_tags=from_tags,
                to_tags=to_tags,
            )
        )
        if len(suggestions) >= 12:
            break
    return suggestions


def _tag_suggestion_title(action: str, from_tags: list[str], to_tags: list[str]) -> str:
    if action == "add":
        return f"补充标签：{'、'.join(to_tags[:3])}"
    if action == "remove":
        return f"删除低价值标签：{'、'.join(from_tags[:3])}"
    return f"{'、'.join(from_tags[:3])} → {'、'.join(to_tags[:2])}"


def _apply_tag_suggestion_to_tags(tags: list[str], suggestion: LearningCardTagSuggestion) -> list[str]:
    current = _normalize_tags(tags)
    from_keys = {tag.lower() for tag in suggestion.from_tags}
    if suggestion.action == "remove":
        return _normalize_tags([tag for tag in current if tag.lower() not in from_keys])
    if suggestion.action in {"merge", "rename"}:
        kept = [tag for tag in current if tag.lower() not in from_keys]
        return _normalize_tags([*kept, *suggestion.to_tags])
    if suggestion.action == "add":
        return _normalize_tags([*current, *suggestion.to_tags])
    return current


def _fallback_learning_card_tag_suggestions(cards: list[LearningCard]) -> list[dict]:
    by_tag: dict[str, list[LearningCard]] = {}
    for card in cards:
        for tag in _safe_json_list(card.tags_json):
            normalized = str(tag).strip()
            if not normalized:
                continue
            by_tag.setdefault(normalized.lower(), []).append(card)
    low_value_tags = [tag for tag, items in by_tag.items() if tag in {"基础", "代码", "通用", "学习"} and items]
    suggestions: list[dict] = []
    for tag in low_value_tags[:4]:
        suggestions.append(
            {
                "action": "remove",
                "title": f"删除低价值标签：{tag}",
                "reason": "这个标签过于宽泛，难以帮助后续检索。",
                "card_ids": [card.id for card in by_tag[tag]],
                "from_tags": [tag],
                "to_tags": [],
            }
        )
    return suggestions


def _learning_card_material_for_card(session: Session, card_id: str) -> LearningCardMaterial | None:
    return session.exec(select(LearningCardMaterial).where(LearningCardMaterial.card_id == card_id)).first()


def _learning_card_material_item(card: LearningCard, material: LearningCardMaterial, cached: bool) -> LearningCardMaterialItem:
    return LearningCardMaterialItem(
        card_id=card.id,
        content_markdown=material.content_markdown,
        source_links=_normalize_resource_links(_safe_json_list(material.source_links_json)),
        model=material.model,
        generated_at=material.generated_at,
        updated_at=material.updated_at,
        cached=cached,
    )


def _learning_card_material_placeholder(card: LearningCard) -> LearningCardMaterialItem:
    tags = [str(item) for item in _safe_json_list(card.tags_json) if str(item).strip()]
    source_links = _normalize_resource_links(_safe_json_list(card.resource_links_json))
    if not source_links:
        source_links = _recommended_learning_resources(card, title=card.title, language_label=card.language_label, tags=tags)
    return LearningCardMaterialItem(
        card_id=card.id,
        content_markdown=_fallback_learning_card_material(card, tags),
        source_links=source_links,
        cached=False,
    )


def _fallback_learning_card_material(card: LearningCard, tags: list[str]) -> str:
    tag_text = "、".join(tags[:4]) if tags else card.language_label
    code = f"\n\n```text\n{card.code_excerpt[:900]}\n```" if card.code_excerpt else ""
    return (
        f"## 概念解释\n{card.title} 是当前卡片需要重点理解的编程知识点。"
        f"{card.explanation}\n\n"
        f"## 适用场景\n- 在 {card.language_label} 学习或项目阅读中遇到 {tag_text} 相关代码时，可以用它建立理解框架。\n"
        "- 复习时建议回到具体代码，看它的输入、输出、边界情况和常见错误。\n\n"
        f"## 最小示例{code or chr(10) + '- 暂无代码片段，可以结合自己的项目补充一个最小例子。'}\n\n"
        "## 常见误区\n- 只记住概念名称，没有结合真实代码理解。\n"
        "- 忽略报错信息、调用位置或数据流，导致复习停留在表面。\n\n"
        "## 延伸阅读\n- 参考右侧来源链接继续学习，并把自己的理解写进笔记。"
    )


def _extract_learning_terms(text: str, limit: int = 12) -> list[str]:
    keywords = [
        "函数", "变量", "循环", "条件判断", "异常处理", "递归", "类", "对象", "模块", "文件操作",
        "路径校验", "API", "数据库", "异步", "状态管理", "组件", "类型", "测试", "安全风险",
        "Numpy", "Pandas", "列表推导式", "字典推导式", "装饰器", "上下文管理器",
    ]
    found: list[str] = []
    lower_text = text.lower()
    for keyword in keywords:
        if keyword.lower() in lower_text and keyword not in found:
            found.append(keyword)
    for match in re.finditer(r"`([^`\n]{2,48})`", text):
        token = match.group(1).strip()
        if token and token not in found:
            found.append(token)
        if len(found) >= limit:
            return found[:limit]
    return found[:limit]


def _topic_counts_from_sources(reports: list[Report], messages: list[ChatMessage], plans: list[AgentPlan]) -> Counter:
    counter: Counter = Counter()
    for report in reports:
        counter.update(_extract_learning_terms(f"{report.title}\n{report.content}", 8))
    for message in messages:
        counter.update(_extract_learning_terms(message.content, 5))
    for plan in plans:
        counter.update(_extract_learning_terms(f"{plan.instruction}\n{plan.summary}\n{plan.apply_result or ''}", 5))
    return counter


def _learning_center(session: Session) -> LearningCenterResponse:
    reports = list(session.exec(select(Report).order_by(Report.created_at.desc()).limit(40)).all())
    chat_sessions = list(session.exec(select(ChatSession).order_by(ChatSession.updated_at.desc()).limit(40)).all())
    messages = list(session.exec(select(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(80)).all())
    plans = list(session.exec(select(AgentPlan).order_by(AgentPlan.updated_at.desc()).limit(40)).all())
    cards = list(session.exec(select(LearningCard).order_by(LearningCard.updated_at.desc()).limit(80)).all())
    metrics = list(session.exec(select(AnalysisMetric).order_by(AnalysisMetric.created_at.desc()).limit(80)).all())
    topic_counter = _topic_counts_from_sources(reports, messages, plans)
    mastered_count = sum(1 for card in cards if card.status == "mastered")
    reviewing_count = sum(1 for card in cards if card.status in {"new", "reviewing", "bookmarked"})
    route_steps = [
        {
            "title": "读懂项目入口",
            "description": "先确认入口文件、配置文件和核心模块，建立项目地图。",
            "status": "active" if plans or reports else "todo",
            "source": "项目导读",
        },
        {
            "title": "掌握核心语法",
            "description": "把报告中的函数、变量、异常处理、数据结构等知识点沉淀成卡片。",
            "status": "done" if cards else "active",
            "source": "知识卡片",
        },
        {
            "title": "定位真实问题",
            "description": "结合 Agent 任务和报告风险提示，学习如何排查和修复代码。",
            "status": "active" if any(plan.status in {"waiting_confirm", "applied", "failed"} for plan in plans) else "todo",
            "source": "Agent 工作区",
        },
        {
            "title": "复盘学习路径",
            "description": "在每日日志中回看当天的报告、对话、Agent 实践和知识卡片沉淀。",
            "status": "done" if len(chat_sessions) + len(reports) >= 6 else "active",
            "source": "每日日志",
        },
    ]
    weak_points = [
        {
            "title": topic,
            "count": count,
            "hint": f"近期多次出现“{topic}”，建议通过知识卡片和项目导读继续巩固。",
        }
        for topic, count in topic_counter.most_common(6)
    ] or [
        {"title": "项目结构", "count": 0, "hint": "当前学习记录较少，建议先生成一次项目导读。"},
        {"title": "函数与变量", "count": 0, "hint": "提交一段代码报告后，系统会自动发现可学习知识点。"},
    ]
    next_actions = [
        {"title": "复习知识卡片", "description": "打开卡片详情，结合代码片段、资料链接和个人笔记复习。", "page": "knowledgeCards"},
        {"title": "生成项目导读", "description": "从当前 VS Code 项目结构出发，建立阅读顺序。", "page": "projectGuide"},
        {"title": "进入 Agent 实践", "description": "把薄弱知识点放进真实修改任务里练习。", "page": "agent"},
    ]
    return LearningCenterResponse(
        stats={
            "reports": len(reports),
            "chat_sessions": len(chat_sessions),
            "agent_tasks": len(plans),
            "learning_cards": len(cards),
            "mastered_cards": mastered_count,
            "reviewing_cards": reviewing_count,
            "code_lines": sum(item.lines for item in metrics),
        },
        route_steps=route_steps,
        weak_points=weak_points,
        recent_learning=[],
        next_actions=next_actions,
    )


def _candidate_learning_cards_from_report(report: Report) -> list[dict]:
    text = f"{report.title}\n{report.content}"
    terms = _extract_learning_terms(text, 10)
    cards: list[dict] = []
    code_excerpt = _first_code_excerpt(report.code_content or report.code_a or report.code_b or "")
    for term in terms:
        tags = _normalize_tags([report.language_label, term, report.mode])
        explanation = _term_explanation(term, report)
        cards.append(
            {
                "title": term,
                "explanation": explanation,
                "difficulty": _term_difficulty(term),
                "tags": tags,
                "code_excerpt": code_excerpt,
                "detail_markdown": _learning_card_detail(term, explanation, tags, report.title),
                "resource_links": _recommended_learning_resources(title=term, language_label=report.language_label, tags=tags),
            }
        )
    if not cards:
        tags = _normalize_tags([report.language_label, report.mode])
        title = report.title[:48]
        explanation = f"来自报告《{report.title}》的学习卡片，建议结合原报告复习代码结构、风险提示和修改建议。"
        cards.append(
            {
                "title": title,
                "explanation": explanation,
                "difficulty": "入门",
                "tags": tags,
                "code_excerpt": code_excerpt,
                "detail_markdown": _learning_card_detail(title, explanation, tags, report.title),
                "resource_links": _recommended_learning_resources(title=title, language_label=report.language_label, tags=tags),
            }
        )
    return cards[:6]


def _learning_card_candidates_for_report(report: Report, limit: int = 8, service: LLMService | None = None) -> list[LearningCardCandidate]:
    code = report.code_content or "\n\n".join(item for item in [report.code_a, report.code_b] if item) or ""
    raw_candidates: list[dict] = []
    if service is not None:
        try:
            raw_candidates = service.generate_learning_card_candidates(
                code=code,
                report_content=report.content,
                report_title=report.title,
                report_mode=report.mode,
                language_code=report.language_code,
                language_label=report.language_label,
                limit=limit,
            )
        except Exception:
            raw_candidates = []
    if not raw_candidates:
        raw_candidates = _candidate_learning_cards_from_report(report)

    candidates: list[LearningCardCandidate] = []
    seen: set[tuple[str, str, str]] = set()
    for item in raw_candidates:
        candidate = _normalize_learning_card_candidate(
            item,
            fallback_language_label=report.language_label,
            fallback_source_id=report.id,
            fallback_source_title=report.title,
        )
        candidate.source_type = "report"
        candidate.source_id = report.id
        key = _learning_card_dedupe_key(candidate)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(candidate)
        if len(candidates) >= limit:
            break
    return candidates


def _first_code_excerpt(code: str) -> str | None:
    lines = [line.rstrip() for line in code.splitlines() if line.strip()]
    return "\n".join(lines[:12]) if lines else None


def _term_explanation(term: str, report: Report) -> str:
    return f"在《{report.title}》中反复出现的知识点。复习时重点理解它在代码中的作用、常见错误以及如何用更清晰的写法表达。"


def _term_difficulty(term: str) -> str:
    if term in {"异步", "装饰器", "上下文管理器", "状态管理", "安全风险", "数据库"}:
        return "进阶"
    if term in {"API", "路径校验", "测试"}:
        return "项目"
    return "入门"


def _flatten_workspace_tree(node: dict | None, depth: int = 0) -> list[dict]:
    if not node:
        return []
    item = {
        "name": node.get("name", ""),
        "path": node.get("path", ""),
        "type": node.get("type", "file"),
        "depth": depth,
        "truncated": bool(node.get("truncated")),
    }
    result = [item]
    for child in node.get("children") or []:
        result.extend(_flatten_workspace_tree(child, depth + 1))
    return result


def _project_guide(session: Session | None) -> ProjectGuideResponse:
    snapshot = _workspace_snapshot_response(_agent_workspace_snapshot)
    tree_data = snapshot.tree.model_dump() if snapshot.tree else None
    nodes = _flatten_workspace_tree(tree_data)
    files = [item for item in nodes if item["type"] == "file"]
    dirs = [item for item in nodes if item["type"] == "directory"]
    entry_names = {"main.py", "app.py", "index.tsx", "main.tsx", "server.py", "package.json", "README.md", "vite.config.ts"}
    entry_candidates = [
        {
            "path": item["path"],
            "name": item["name"],
            "reason": _entry_reason(item["name"], item["path"]),
        }
        for item in files
        if item["name"] in entry_names or item["path"].endswith("/main.py") or item["path"].endswith("/App.tsx")
    ][:10]
    area_counter: Counter = Counter()
    for item in files:
        first = item["path"].split("/", 1)[0] if item["path"] else item["name"]
        if first:
            area_counter[first] += 1
    core_areas = [
        {
            "name": name,
            "file_count": count,
            "description": _area_description(name),
        }
        for name, count in area_counter.most_common(8)
    ]
    read_order = [
        {"step": 1, "title": "先看说明与配置", "paths": [item["path"] for item in files if item["name"].lower().startswith("readme") or item["name"] in {"package.json", "requirements.txt", "pyproject.toml"}][:5]},
        {"step": 2, "title": "定位入口文件", "paths": [item["path"] for item in entry_candidates[:5]]},
        {"step": 3, "title": "阅读核心业务目录", "paths": [item["name"] for item in core_areas[:4]]},
        {
            "step": 4,
            "title": "结合报告和 Agent 任务复盘",
            "paths": [item.title for item in session.exec(select(Report).order_by(Report.created_at.desc()).limit(4)).all()] if session else [],
        },
    ]
    notes = []
    if not snapshot.connected or snapshot.stale:
        notes.append("未收到最新 VS Code 插件心跳，项目导读基于后端当前可见状态生成。")
    if snapshot.truncated:
        notes.append("项目树已按深度或节点数量截断，导读优先覆盖当前可见文件。")
    if not files:
        notes.append("当前没有可用项目树，请先打开 VS Code 插件并等待心跳同步。")
    return ProjectGuideResponse(
        workspace={
            "name": snapshot.workspace_name,
            "root": snapshot.workspace_root,
            "status": snapshot.status,
            "node_count": snapshot.node_count,
            "file_count": len(files),
            "directory_count": len(dirs),
            "connected": snapshot.connected and not snapshot.stale,
        },
        entry_candidates=entry_candidates,
        core_areas=core_areas,
        read_order=read_order,
        knowledge_points=_project_knowledge_points(files),
        notes=notes,
    )


def _entry_reason(name: str, file_path: str) -> str:
    lower_name = name.lower()
    if lower_name.startswith("readme"):
        return "项目说明文件，适合先建立整体认识。"
    if lower_name in {"package.json", "requirements.txt", "pyproject.toml"}:
        return "依赖与运行配置，能帮助理解项目技术栈。"
    if lower_name in {"main.py", "app.py", "server.py", "main.tsx", "index.tsx"}:
        return "常见启动入口或前端挂载入口。"
    if file_path.endswith("/App.tsx"):
        return "前端应用主组件，适合理解页面结构。"
    return "从路径命名看可能是项目入口。"


def _area_description(name: str) -> str:
    lower_name = name.lower()
    if lower_name == "backend":
        return "后端接口、数据模型和 AI 服务逻辑。"
    if lower_name == "frontend":
        return "Web 页面、组件、样式和 API 调用。"
    if lower_name == "vscode-extension":
        return "VS Code 插件、项目上下文采集和本地执行。"
    if lower_name in {"tests", "test"}:
        return "自动化测试与回归验证。"
    if lower_name in {"codelens", "src", "app"}:
        return "核心业务代码目录。"
    return "项目中的独立功能区域。"


def _project_knowledge_points(files: list[dict]) -> list[str]:
    joined = " ".join(item["path"].lower() for item in files)
    points: list[str] = []
    if ".py" in joined:
        points.extend(["Python 模块组织", "异常处理", "后端接口"])
    if ".tsx" in joined or ".ts" in joined:
        points.extend(["TypeScript 类型", "React 组件", "前端状态管理"])
    if "alembic" in joined or "models.py" in joined:
        points.append("数据库迁移与模型设计")
    if "vscode-extension" in joined:
        points.append("VS Code 插件通信")
    if "tests" in joined:
        points.append("自动化测试")
    return list(dict.fromkeys(points))[:10]


def _learning_review(session: Session, period: str) -> LearningReviewResponse:
    since = None
    if period == "week":
        since = datetime.utcnow() - timedelta(days=7)
    elif period == "month":
        since = datetime.utcnow() - timedelta(days=30)

    reports = list(session.exec(select(Report).order_by(Report.created_at.desc())).all())
    chats = list(session.exec(select(ChatSession).order_by(ChatSession.updated_at.desc())).all())
    messages = list(session.exec(select(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(160)).all())
    plans = list(session.exec(select(AgentPlan).order_by(AgentPlan.updated_at.desc())).all())
    cards = list(session.exec(select(LearningCard).order_by(LearningCard.updated_at.desc())).all())
    if since:
        reports = [item for item in reports if item.created_at >= since]
        chats = [item for item in chats if item.updated_at >= since]
        messages = [item for item in messages if item.created_at >= since]
        plans = [item for item in plans if item.updated_at >= since]
        cards = [item for item in cards if item.updated_at >= since]

    topic_counter = _topic_counts_from_sources(reports, messages, plans)
    focus_areas = [
        {"title": topic, "count": count, "summary": f"本周期内多次涉及 {topic}，建议继续结合代码案例复习。"}
        for topic, count in topic_counter.most_common(6)
    ]
    stats = {
        "reports": len(reports),
        "chat_sessions": len(chats),
        "agent_tasks": len(plans),
        "learning_cards": len(cards),
        "mastered_cards": sum(1 for item in cards if item.status == "mastered"),
    }
    summary = (
        f"本周期共生成 {stats['reports']} 份报告、进行 {stats['chat_sessions']} 次对话、推进 {stats['agent_tasks']} 个 Agent 任务。"
        f" 当前沉淀 {stats['learning_cards']} 张知识卡片。"
    )
    timeline = _recent_activity(session, limit=12)
    recommendations = [
        {"title": "复习高频知识点", "description": "优先处理复盘中出现次数最多的 2-3 个主题。"},
        {"title": "补齐知识卡片", "description": "把最近报告里的关键概念生成卡片，并标记掌握状态。"},
        {"title": "用项目导读串联知识", "description": "把零散语法点放回真实项目结构中理解。"},
    ]
    return LearningReviewResponse(
        period=period,
        summary=summary,
        stats=stats,
        focus_areas=focus_areas or [{"title": "学习记录不足", "count": 0, "summary": "建议先生成报告或项目导读。"}],
        recurring_topics=[{"label": topic, "value": count} for topic, count in topic_counter.most_common(10)],
        timeline=timeline,
        recommendations=recommendations,
    )


WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _parse_log_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")


def _day_start(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time())


def _day_end(day: date) -> datetime:
    return _day_start(day) + timedelta(days=1)


def _date_range_filter(column, day: date):
    return column >= _day_start(day), column < _day_end(day)


def _daily_log_for_date(session: Session, day: date) -> DailyWorkLog | None:
    start, end = _date_range_filter(DailyWorkLog.log_date, day)
    return session.exec(select(DailyWorkLog).where(start).where(end)).first()


def _daily_logs_by_date(session: Session, start_day: date, end_day: date) -> dict[date, DailyWorkLog]:
    rows = list(
        session.exec(
            select(DailyWorkLog)
            .where(DailyWorkLog.log_date >= _day_start(start_day))
            .where(DailyWorkLog.log_date < _day_end(end_day))
            .order_by(DailyWorkLog.log_date.desc())
        ).all()
    )
    return {row.log_date.date(): row for row in rows}


def _daily_activity_stats(session: Session, day: date) -> dict[str, int]:
    report_start, report_end = _date_range_filter(Report.created_at, day)
    chat_start, chat_end = _date_range_filter(ChatMessage.created_at, day)
    plan_start, plan_end = _date_range_filter(AgentPlan.updated_at, day)
    card_start, card_end = _date_range_filter(LearningCard.updated_at, day)
    reports = len(list(session.exec(select(Report.id).where(report_start).where(report_end)).all()))
    messages = len(list(session.exec(select(ChatMessage.id).where(chat_start).where(chat_end)).all()))
    plans = len(list(session.exec(select(AgentPlan.id).where(plan_start).where(plan_end)).all()))
    cards = len(list(session.exec(select(LearningCard.id).where(card_start).where(card_end)).all()))
    return {
        "reports": reports,
        "messages": messages,
        "agent_tasks": plans,
        "learning_cards": cards,
        "total_activity": reports + messages + plans + cards,
    }


def _daily_calendar_item(session: Session, day: date, log: DailyWorkLog | None) -> DailyWorkLogCalendarItem:
    stats = _daily_activity_stats(session, day)
    summary = None
    if log:
        summary = _compact_daily_summary(log.content_markdown)
    return DailyWorkLogCalendarItem(
        date=day.isoformat(),
        weekday=WEEKDAY_LABELS[day.weekday()],
        has_activity=bool(stats["total_activity"]),
        has_log=bool(log),
        activity_score=min(6, stats["reports"] * 2 + stats["agent_tasks"] * 2 + stats["learning_cards"] + max(0, stats["messages"] // 3)),
        title=log.title if log else None,
        summary=summary,
        generated_at=log.generated_at if log else None,
        stats=stats,
    )


def _daily_work_log_item(session: Session, day: date, log: DailyWorkLog | None) -> DailyWorkLogItem:
    stats = _daily_activity_stats(session, day)
    if not log:
        return DailyWorkLogItem(
            date=day.isoformat(),
            title=f"{day.isoformat()} 工作日志",
            content_markdown="",
            source_stats=stats,
            source_refs=[],
            has_activity=bool(stats["total_activity"]),
            has_log=False,
        )
    return DailyWorkLogItem(
        id=log.id,
        date=day.isoformat(),
        title=log.title,
        content_markdown=log.content_markdown,
        source_stats=_safe_json_dict(log.source_stats_json) or stats,
        source_refs=[item for item in _safe_json_list(log.source_refs_json) if isinstance(item, dict)],
        model=log.model,
        generated_at=log.generated_at,
        updated_at=log.updated_at,
        has_activity=bool(stats["total_activity"]),
        has_log=True,
    )


def _safe_json_dict(value: str | None) -> dict:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _compact_daily_summary(content: str) -> str:
    for line in content.splitlines():
        text = re.sub(r"^[#*\-\s>]+", "", line).strip()
        if text and not text.startswith(("今日概览", "完成事项", "AI 对话", "Agent", "知识卡片", "明日建议")):
            return text[:72]
    return "已生成当日工作日志"


def _clip_daily_text(text: str, limit: int) -> str:
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n...（已截断）"


def _daily_work_context(session: Session, day: date) -> dict[str, Any]:
    report_start, report_end = _date_range_filter(Report.created_at, day)
    message_start, message_end = _date_range_filter(ChatMessage.created_at, day)
    plan_start, plan_end = _date_range_filter(AgentPlan.updated_at, day)
    card_start, card_end = _date_range_filter(LearningCard.updated_at, day)

    reports = list(session.exec(select(Report).where(report_start).where(report_end).order_by(Report.created_at.desc()).limit(12)).all())
    messages = list(session.exec(select(ChatMessage).where(message_start).where(message_end).order_by(ChatMessage.created_at).limit(80)).all())
    plans = list(session.exec(select(AgentPlan).where(plan_start).where(plan_end).order_by(AgentPlan.updated_at.desc()).limit(12)).all())
    cards = list(session.exec(select(LearningCard).where(card_start).where(card_end).order_by(LearningCard.updated_at.desc()).limit(16)).all())
    session_ids = {item.session_id for item in messages}
    chat_sessions = {
        item.id: item
        for item in session.exec(select(ChatSession).where(ChatSession.id.in_(session_ids))).all()
    } if session_ids else {}

    stats = {
        "reports": len(reports),
        "messages": len(messages),
        "chat_sessions": len(chat_sessions),
        "agent_tasks": len(plans),
        "learning_cards": len(cards),
        "total_activity": len(reports) + len(messages) + len(plans) + len(cards),
    }
    refs: list[dict[str, Any]] = []
    parts = [f"# {day.isoformat()} 使用记录"]

    parts.append("\n## 报告")
    if reports:
        for report in reports:
            refs.append({"type": "report", "id": report.id, "title": report.title})
            parts.append(
                f"- {report.title}（{report.language_label} / {report.mode}）："
                f"{_clip_daily_text(report.content, 620)}"
            )
    else:
        parts.append("- 无报告记录。")

    parts.append("\n## AI 对话")
    if messages:
        for message in messages[:40]:
            session_title = chat_sessions.get(message.session_id).title if chat_sessions.get(message.session_id) else "未命名会话"
            role = "用户" if message.role == "user" else "AI"
            refs.append({"type": "chat", "id": message.session_id, "title": session_title})
            parts.append(f"- [{session_title}] {role}: {_clip_daily_text(message.content, 360)}")
    else:
        parts.append("- 无对话记录。")

    parts.append("\n## Agent 任务")
    if plans:
        for plan in plans:
            refs.append({"type": "agent", "id": plan.id, "title": plan.summary or plan.instruction})
            selected_files = ", ".join(_selected_file_paths(plan)[:6]) or "未指定文件"
            parts.append(
                f"- {plan.summary or plan.instruction}；状态：{plan.status}；文件：{selected_files}；"
                f"结果：{_clip_daily_text(plan.apply_result or '', 420)}"
            )
    else:
        parts.append("- 无 Agent 任务记录。")

    parts.append("\n## 知识卡片")
    if cards:
        for card in cards:
            refs.append({"type": "card", "id": card.id, "title": card.title})
            notes = f"；笔记：{_clip_daily_text(card.notes or '', 260)}" if card.notes else ""
            parts.append(f"- {card.title}（{card.language_label} / {card.status}）：{_clip_daily_text(card.explanation, 320)}{notes}")
    else:
        parts.append("- 无知识卡片记录。")

    deduped_refs: list[dict[str, Any]] = []
    seen_refs: set[tuple[str, str]] = set()
    for item in refs:
        key = (str(item.get("type")), str(item.get("id")))
        if key in seen_refs:
            continue
        seen_refs.add(key)
        deduped_refs.append(item)

    return {"stats": stats, "refs": deduped_refs[:80], "context_markdown": "\n".join(parts)}


def _daily_log_title(day: date, content: str) -> str:
    for line in content.splitlines():
        title = line.strip().lstrip("#").strip()
        if title and not title.startswith(("今日概览", "完成事项")):
            return title[:80]
    return f"{day.isoformat()} 工作日志"


def _fallback_daily_work_log(day: date, stats: dict[str, int]) -> str:
    return (
        f"# {day.isoformat()} 工作日志\n\n"
        "## 今日概览\n"
        f"今天共产生 {stats.get('reports', 0)} 份报告、{stats.get('messages', 0)} 条 AI 对话消息、"
        f"{stats.get('agent_tasks', 0)} 个 Agent 任务和 {stats.get('learning_cards', 0)} 张知识卡片记录。\n\n"
        "## 完成事项\n- 已整理当天 CodeLens Pro 使用记录。\n\n"
        "## AI 对话与报告\n- 可回到报告、对话和历史页面查看具体内容。\n\n"
        "## Agent 实践\n- 可结合 Agent 状态继续跟进修改任务。\n\n"
        "## 知识卡片与学习\n- 建议把高频知识点补充为卡片并记录笔记。\n\n"
        "## 明日建议\n- 选择一个重点主题继续分析、实践和复盘。"
    )


def error_payload(code: str, message: str, hint: str = "") -> dict[str, str]:
    return {"code": code, "message": message, "hint": hint}


def _mysql_error_payload(message: str) -> dict[str, str]:
    return error_payload(
        "MYSQL_NOT_CONNECTED",
        f"MySQL 未连接：{message}",
        "请确认本地 MySQL 服务、DATABASE_URL 和数据库账号密码配置正确。",
    )


def _llm_error_payload(exc: Exception) -> dict[str, str]:
    message = str(exc)
    if "DEEPSEEK_API_KEY" in message:
        return error_payload(
            "LLM_KEY_MISSING",
            message,
            "请在 .env 中配置 DEEPSEEK_API_KEY 后重启后端。",
        )
    return error_payload(
        "LLM_REQUEST_FAILED",
        message,
        "请检查模型名称、网络连接、DeepSeek 余额和 API Base URL。",
    )


def _metric_summary(metrics: dict) -> dict[str, int]:
    functions = metrics.get("functions", {}) or {}
    return {
        "lines": int(metrics.get("lines", 0) or 0),
        "functions": int(functions.get("count", 0) or 0),
        "risks": len(metrics.get("secrets_risk", []) or []),
    }


def parse_report_outline(content: str) -> list[dict[str, str | int]]:
    outline: list[dict[str, str | int]] = []
    seen: dict[str, int] = {}
    for line in content.splitlines():
        match = re.match(r"^(#{1,3})\s+(.+?)\s*$", line)
        if not match:
            continue
        text = re.sub(r"[#*_`>\[\]{}()（）【】\"'“”‘’]+", " ", match.group(2)).strip()
        if not text:
            continue
        base = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", text).strip("-").lower() or "section"
        seen[base] = seen.get(base, 0) + 1
        item_id = base if seen[base] == 1 else f"{base}-{seen[base]}"
        outline.append({"id": item_id, "text": text[:80], "level": len(match.group(1))})
    return outline[:48]


def _analytics_summary(session: Session) -> dict:
    reports = list(session.exec(select(Report)).all())
    chat_sessions = list(session.exec(select(ChatSession)).all())
    chat_messages = list(session.exec(select(ChatMessage)).all())
    metrics = list(session.exec(select(AnalysisMetric)).all())
    agent_plans = list(session.exec(select(AgentPlan)).all())
    learning_cards = list(session.exec(select(LearningCard)).all())
    learning_materials = list(session.exec(select(LearningCardMaterial)).all())
    daily_logs = list(session.exec(select(DailyWorkLog)).all())
    return {
        "reports": len(reports),
        "single_reports": sum(1 for item in reports if item.report_type == "single"),
        "diff_reports": sum(1 for item in reports if item.report_type == "diff"),
        "chat_sessions": len(chat_sessions),
        "agent_tasks": len(agent_plans),
        "code_lines": sum(item.lines for item in metrics),
        "security_risks": sum(_json_list_count(item.secrets_json) for item in metrics),
        "total_tokens": _total_content_tokens(
            session,
            reports=reports,
            chat_messages=chat_messages,
            agent_plans=agent_plans,
            learning_cards=learning_cards,
            learning_materials=learning_materials,
            daily_logs=daily_logs,
        ),
    }


def _total_content_tokens(
    session: Session,
    *,
    reports: list[Report] | None = None,
    chat_messages: list[ChatMessage] | None = None,
    agent_plans: list[AgentPlan] | None = None,
    learning_cards: list[LearningCard] | None = None,
    learning_materials: list[LearningCardMaterial] | None = None,
    daily_logs: list[DailyWorkLog] | None = None,
) -> int:
    reports = reports if reports is not None else list(session.exec(select(Report)).all())
    chat_messages = chat_messages if chat_messages is not None else list(session.exec(select(ChatMessage)).all())
    agent_plans = agent_plans if agent_plans is not None else list(session.exec(select(AgentPlan)).all())
    learning_cards = learning_cards if learning_cards is not None else list(session.exec(select(LearningCard)).all())
    learning_materials = learning_materials if learning_materials is not None else list(session.exec(select(LearningCardMaterial)).all())
    daily_logs = daily_logs if daily_logs is not None else list(session.exec(select(DailyWorkLog)).all())

    report_tokens = sum(
        count_tokens(item.code_content)
        + count_tokens(item.code_a)
        + count_tokens(item.code_b)
        + count_tokens(item.content)
        for item in reports
    )
    chat_tokens = sum(count_tokens(item.content) for item in chat_messages)
    agent_tokens = sum(
        count_tokens(item.instruction)
        + count_tokens(item.summary)
        + count_tokens(item.assumptions_json)
        + count_tokens(item.warnings_json)
        + count_tokens(item.operations_json)
        + count_tokens(item.selected_files_json)
        + count_tokens(item.apply_result)
        for item in agent_plans
    )
    learning_tokens = sum(
        count_tokens(item.title)
        + count_tokens(item.explanation)
        + count_tokens(item.tags_json)
        + count_tokens(item.code_excerpt)
        + count_tokens(item.detail_markdown)
        + count_tokens(item.notes)
        + count_tokens(item.resource_links_json)
        for item in learning_cards
    )
    material_tokens = sum(
        count_tokens(item.content_markdown)
        + count_tokens(item.source_links_json)
        for item in learning_materials
    )
    daily_log_tokens = sum(
        count_tokens(item.title)
        + count_tokens(item.content_markdown)
        + count_tokens(item.source_stats_json)
        + count_tokens(item.source_refs_json)
        for item in daily_logs
    )
    return report_tokens + chat_tokens + agent_tokens + learning_tokens + material_tokens + daily_log_tokens


def _recent_activity(session: Session, limit: int = 16) -> list[dict]:
    labels = _mode_labels()
    activities: list[dict] = []

    for report in session.exec(select(Report).order_by(Report.created_at.desc()).limit(limit)).all():
        activities.append(
            {
                "id": f"report-{report.id}",
                "kind": "report",
                "title": report.title,
                "subtitle": labels.get(report.mode, report.mode),
                "status": "done",
                "target_id": report.id,
                "created_at": report.created_at.isoformat(),
                "route": {
                    "page": "report",
                    "target_id": report.id,
                    "report_type": report.report_type,
                },
            }
        )

    chats = list(session.exec(select(ChatSession).order_by(ChatSession.updated_at.desc()).limit(limit)).all())
    report_titles = _report_titles(session, {item.report_id for item in chats if item.report_id})
    for chat in chats:
        activities.append(
            {
                "id": f"chat-{chat.id}",
                "kind": "chat",
                "title": chat.title,
                "subtitle": report_titles.get(chat.report_id or "") or _chat_type_label(chat.context_type),
                "status": "active",
                "target_id": chat.id,
                "created_at": chat.updated_at.isoformat(),
                "route": {
                    "page": "agent" if chat.context_type == "agent" else "chat",
                    "target_id": chat.id,
                    "session_id": chat.id,
                    "context_type": chat.context_type,
                },
            }
        )

    for plan in session.exec(select(AgentPlan).order_by(AgentPlan.updated_at.desc()).limit(limit)).all():
        activities.append(
            {
                "id": f"agent-{plan.id}",
                "kind": "agent",
                "title": plan.summary or "Agent 任务",
                "subtitle": plan.apply_result or ("网页端任务" if plan.source == "web" else "插件计划"),
                "status": plan.status,
                "target_id": plan.id,
                "created_at": plan.updated_at.isoformat(),
                "route": {
                    "page": "agent",
                    "target_id": plan.id,
                    "plan_id": plan.id,
                    "session_id": plan.session_id,
                },
            }
        )

    return sorted(activities, key=lambda item: item["created_at"], reverse=True)[:limit]


def _workspace_snapshot_response(snapshot: AgentWorkspaceSnapshot | None) -> AgentWorkspaceSnapshot:
    if snapshot is None:
        return AgentWorkspaceSnapshot(
            workspace_name="",
            workspace_root="",
            status="disconnected",
            tree=None,
            node_count=0,
            truncated=False,
            connected=False,
            stale=True,
            updated_at=None,
        )

    updated_at = snapshot.updated_at
    stale = True
    if updated_at is not None:
        stale = (datetime.utcnow() - updated_at).total_seconds() > WORKSPACE_STALE_SECONDS
    return snapshot.model_copy(update={"connected": not stale, "stale": stale})


def _chat_type_label(context_type: str) -> str:
    if context_type == "report":
        return "报告上下文对话"
    if context_type == "agent":
        return "Agent 工作区"
    return "普通 AI 对话"


def _agent_plan_message(plan: AgentPlan) -> str:
    operations = _safe_json_list(plan.operations_json)
    warnings = _safe_json_list(plan.warnings_json)
    lines = [
        "Agent 计划已生成。",
        "",
        f"摘要：{plan.summary}",
        f"操作数：{len(operations)}",
        f"来源：{'网页端' if plan.source == 'web' else 'VS Code 插件'}",
    ]
    if warnings:
        lines.extend(["", "提醒：", *[f"- {item}" for item in warnings[:6]]])
    return "\n".join(lines)


def _agent_plan_item(plan: AgentPlan) -> AgentPlanItem:
    return AgentPlanItem(
        id=plan.id,
        session_id=plan.session_id,
        plan_id=plan.id,
        title=None,
        instruction=plan.instruction,
        summary=plan.summary,
        assumptions=_safe_json_list(plan.assumptions_json),
        warnings=_safe_json_list(plan.warnings_json),
        operations=_safe_json_list(plan.operations_json),
        selected_file_paths=_selected_file_paths(plan),
        context_mode=_context_mode(plan),
        status=plan.status,
        source=plan.source,
        apply_result=plan.apply_result,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _report_titles(session: Session, report_ids: set[str]) -> dict[str, str]:
    if not report_ids:
        return {}

    reports = session.exec(select(Report).where(Report.id.in_(report_ids))).all()
    return {report.id: report.title for report in reports}


def _mode_labels() -> dict[str, str]:
    labels: dict[str, str] = {}
    for modes in REPORT_MODES.values():
        for item in modes:
            labels[item["id"]] = item["label"]
    labels.setdefault("func_knowledge", "知识点提炼")
    return labels


def _ensure_unique_title(
    session: Session,
    model: type[Report] | type[ChatSession],
    title: str,
    current_id: str | None = None,
) -> str:
    base = (title or "").strip()[:150] or "未命名"
    candidate = base
    counter = 2
    while True:
        existing = session.exec(select(model).where(model.title == candidate)).first()
        if not existing or existing.id == current_id:
            return candidate

        suffix = f"（{counter}）"
        candidate = f"{base[:160 - len(suffix)]}{suffix}"
        counter += 1


def _safe_report_title(service: LLMService, code_context: str, content: str, fallback: str, report_type: str) -> str:
    try:
        return service.generate_report_title(code_context, content, fallback, report_type)
    except Exception:
        return fallback


def _safe_chat_title(service: LLMService, user_message: str, assistant_reply: str, fallback: str) -> str:
    try:
        return service.generate_chat_title(user_message, assistant_reply, fallback)
    except Exception:
        return build_chat_fallback_title(user_message, assistant_reply, fallback)


def _json_list_count(value: str | None) -> int:
    if not value:
        return 0
    try:
        data = json.loads(value)
    except Exception:
        return 0
    return len(data) if isinstance(data, list) else 0


@router.get("/analytics", response_model=AnalyticsResponse)
def read_analytics(session: Session = Depends(get_session)) -> AnalyticsResponse:
    reports = list(session.exec(select(Report)).all())
    chat_sessions = list(session.exec(select(ChatSession)).all())
    chat_messages = list(session.exec(select(ChatMessage)).all())
    metrics = list(session.exec(select(AnalysisMetric)).all())
    agent_plans = list(session.exec(select(AgentPlan)).all())
    learning_cards = list(session.exec(select(LearningCard)).all())
    learning_materials = list(session.exec(select(LearningCardMaterial)).all())
    daily_logs = list(session.exec(select(DailyWorkLog)).all())

    single_reports = [item for item in reports if item.report_type == "single"]
    diff_reports = [item for item in reports if item.report_type == "diff"]
    user_messages = [item for item in chat_messages if item.role == "user"]
    report_chats = [item for item in chat_sessions if item.context_type == "report"]
    agent_chats = [item for item in chat_sessions if item.context_type == "agent"]
    general_chats = [item for item in chat_sessions if item.context_type == "general"]

    labels = _mode_labels()
    report_type_counts = [
        {"label": "工作台报告", "value": len(single_reports)},
        {"label": "代码对比报告", "value": len(diff_reports)},
    ]
    chat_type_counts = [
        {"label": "普通对话", "value": len(general_chats)},
        {"label": "报告对话", "value": len(report_chats)},
        {"label": "Agent 对话", "value": len(agent_chats)},
    ]
    mode_counter = Counter(item.mode for item in reports)
    report_mode_counts = [
        {"label": labels.get(mode, mode), "value": count}
        for mode, count in mode_counter.most_common(8)
    ]

    today = date.today()
    day_range = [today - timedelta(days=offset) for offset in range(13, -1, -1)]
    daily_activity = []
    for day in day_range:
        report_count = sum(1 for item in reports if item.created_at.date() == day)
        chat_count = sum(1 for item in user_messages if item.created_at.date() == day)
        daily_activity.append(
            {
                "date": day.isoformat(),
                "reports": report_count,
                "chats": chat_count,
                "total": report_count + chat_count,
            }
        )

    total_tokens = _total_content_tokens(
        session,
        reports=reports,
        chat_messages=chat_messages,
        agent_plans=agent_plans,
        learning_cards=learning_cards,
        learning_materials=learning_materials,
        daily_logs=daily_logs,
    )
    token_status = tokenizer_status()
    balance = fetch_deepseek_balance()

    total_lines = sum(item.lines for item in metrics)
    total_functions = sum(item.functions_count for item in metrics)
    total_risks = sum(_json_list_count(item.secrets_json) for item in metrics)

    return AnalyticsResponse(
        totals={
            "reports": len(reports),
            "single_reports": len(single_reports),
            "diff_reports": len(diff_reports),
            "chat_sessions": len(chat_sessions),
            "general_chats": len(general_chats),
            "report_chats": len(report_chats),
            "chat_messages": len(chat_messages),
            "agent_tasks": len(agent_plans),
            "learning_cards": len(learning_cards),
            "learning_materials": len(learning_materials),
            "daily_logs": len(daily_logs),
            "code_lines": total_lines,
            "functions": total_functions,
            "security_risks": total_risks,
        },
        tool_usage=[
            {"label": "工作台", "value": len(single_reports)},
            {"label": "代码对比", "value": len(diff_reports)},
            {"label": "AI 对话", "value": len(user_messages)},
        ],
        report_type_counts=report_type_counts,
        report_mode_counts=report_mode_counts,
        chat_type_counts=chat_type_counts,
        daily_activity=daily_activity,
        token_usage={
            "estimated": bool(token_status.get("fallback")),
            "method": token_status.get("method"),
            "tokenizer_available": token_status.get("available"),
            "tokenizer_source": token_status.get("source"),
            "refreshed_at": datetime.utcnow().isoformat(),
            "total_tokens": total_tokens,
            "items": [
                {"label": "Token", "value": total_tokens},
            ],
        },
        api_balance=balance,
    )


@router.post("/reports/stream")
def stream_report(payload: ReportStreamRequest) -> StreamingResponse:
    def event_generator():
        chunks: list[str] = []
        try:
            mysql_ok, mysql_message = check_database()
            if not mysql_ok:
                yield sse_event("error", _mysql_error_payload(mysql_message))
                return

            service = LLMService(payload.model)
            for text in service.stream_report(
                payload.code,
                payload.mode,
                payload.language_code,
                payload.language_label,
            ):
                chunks.append(text)
                yield sse_event("delta", {"text": text})

            content = "".join(chunks).strip()
            metrics = scan_code(payload.code, payload.language_code)
            fallback_title = report_title(payload.mode)
            generated_title = _safe_report_title(service, payload.code, content, fallback_title, "single")
            with Session(engine) as session:
                final_title = _ensure_unique_title(session, Report, generated_title)
                report = Report(
                    title=final_title,
                    report_type="single",
                    mode=payload.mode,
                    language_label=payload.language_label,
                    language_code=payload.language_code,
                    model=resolve_model(payload.model or settings.deepseek_default_model),
                    code_content=payload.code,
                    content=content,
                )
                session.add(report)
                session.flush()
                _save_metric(session, report.id, metrics)
                session.commit()
                learning_card_candidates: list[dict] = []
                learning_card_candidate_error: str | None = None
                if payload.generate_learning_card_candidates:
                    yield sse_event(
                        "status",
                        {"phase": "learning_cards", "message": "知识卡片正在生成中..."},
                    )
                    try:
                        learning_card_candidates = [
                            item.model_dump()
                            for item in _learning_card_candidates_for_report(report, limit=8, service=service)
                        ]
                    except Exception as candidate_exc:
                        learning_card_candidate_error = str(candidate_exc)[:240]
                yield sse_event(
                    "done",
                    {
                        "id": report.id,
                        "title": report.title,
                        "created_at": report.created_at.isoformat(),
                        "report_type": report.report_type,
                        "mode": report.mode,
                        "metrics_summary": _metric_summary(metrics),
                        "learning_card_candidates": learning_card_candidates,
                        "learning_card_candidate_error": learning_card_candidate_error,
                    },
                )
        except Exception as exc:
            yield sse_event("error", _llm_error_payload(exc))

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


@router.post("/diff/stream")
def stream_diff(payload: DiffStreamRequest) -> StreamingResponse:
    def event_generator():
        chunks: list[str] = []
        try:
            mysql_ok, mysql_message = check_database()
            if not mysql_ok:
                yield sse_event("error", _mysql_error_payload(mysql_message))
                return

            service = LLMService(payload.model)
            for text in service.stream_diff(
                payload.code_a,
                payload.code_b,
                payload.mode,
                payload.language_code,
                payload.language_label,
            ):
                chunks.append(text)
                yield sse_event("delta", {"text": text})

            content = "".join(chunks).strip()
            combined_code = f"{payload.code_a}\n\n{payload.code_b}"
            metrics = scan_code(combined_code, payload.language_code)
            fallback_title = report_title(payload.mode)
            generated_title = _safe_report_title(service, combined_code, content, fallback_title, "diff")
            with Session(engine) as session:
                final_title = _ensure_unique_title(session, Report, generated_title)
                report = Report(
                    title=final_title,
                    report_type="diff",
                    mode=payload.mode,
                    language_label=payload.language_label,
                    language_code=payload.language_code,
                    model=resolve_model(payload.model or settings.deepseek_default_model),
                    code_a=payload.code_a,
                    code_b=payload.code_b,
                    content=content,
                )
                session.add(report)
                session.flush()
                _save_metric(session, report.id, metrics)
                session.commit()
                learning_card_candidates: list[dict] = []
                learning_card_candidate_error: str | None = None
                if payload.generate_learning_card_candidates:
                    yield sse_event(
                        "status",
                        {"phase": "learning_cards", "message": "知识卡片正在生成中..."},
                    )
                    try:
                        learning_card_candidates = [
                            item.model_dump()
                            for item in _learning_card_candidates_for_report(report, limit=8, service=service)
                        ]
                    except Exception as candidate_exc:
                        learning_card_candidate_error = str(candidate_exc)[:240]
                yield sse_event(
                    "done",
                    {
                        "id": report.id,
                        "title": report.title,
                        "created_at": report.created_at.isoformat(),
                        "report_type": report.report_type,
                        "mode": report.mode,
                        "metrics_summary": _metric_summary(metrics),
                        "learning_card_candidates": learning_card_candidates,
                        "learning_card_candidate_error": learning_card_candidate_error,
                    },
                )
        except Exception as exc:
            yield sse_event("error", _llm_error_payload(exc))

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


@router.post("/chat/stream")
def stream_chat(payload: ChatStreamRequest) -> StreamingResponse:
    def event_generator():
        chunks: list[str] = []
        try:
            mysql_ok, mysql_message = check_database()
            if not mysql_ok:
                yield sse_event("error", {"message": f"MySQL 未连接：{mysql_message}"})
                return

            with Session(engine) as session:
                chat_session = None
                report = None
                history: list[dict[str, str]] = []
                should_auto_name_chat = False
                if payload.session_id:
                    chat_session = session.get(ChatSession, payload.session_id)
                    if chat_session and chat_session.report_id:
                        report = session.get(Report, chat_session.report_id)

                if not chat_session and payload.report_id:
                    report = session.get(Report, payload.report_id)
                    if not report:
                        yield sse_event(
                            "error",
                            error_payload(
                                "REPORT_NOT_FOUND",
                                "关联报告不存在，无法继续对话。",
                                "请回到历史报告重新打开这份报告后再提问。",
                            ),
                        )
                        return

                    chat_session = session.exec(
                        select(ChatSession)
                        .where(ChatSession.report_id == report.id)
                        .order_by(ChatSession.updated_at.desc())
                    ).first()

                if chat_session:
                    statement = (
                        select(ChatMessage)
                        .where(ChatMessage.session_id == chat_session.id)
                        .order_by(ChatMessage.created_at)
                        .limit(20)
                    )
                    history = [
                        {"role": item.role, "content": item.content}
                        for item in session.exec(statement).all()
                        if item.role in {"user", "assistant"}
                    ]

                if not chat_session:
                    if report:
                        title = _ensure_unique_title(session, ChatSession, f"{report.title}·关联对话")
                    else:
                        title = _ensure_unique_title(session, ChatSession, build_chat_fallback_title(payload.message, "", "新的对话"))
                    chat_session = ChatSession(
                        title=title,
                        context_type="report" if report else (payload.context_type or "general"),
                        report_id=report.id if report else None,
                    )
                    should_auto_name_chat = report is None
                    session.add(chat_session)
                    session.flush()

                session.add(ChatMessage(session_id=chat_session.id, role="user", content=payload.message))
                chat_session.updated_at = datetime.utcnow()
                session.add(chat_session)
                session.commit()
                session_id = chat_session.id
                report_id = chat_session.report_id

            code_context = payload.code_context
            report_context = payload.report_context
            if report and (not code_context or not report_context):
                stored_code_context, stored_report_context = _chat_report_context(report)
                code_context = code_context or stored_code_context
                report_context = report_context or stored_report_context

            service = LLMService(payload.model)
            for text in service.stream_chat(
                payload.message,
                history,
                code_context=code_context,
                report_context=report_context,
            ):
                chunks.append(text)
                yield sse_event("delta", {"text": text})

            reply = "".join(chunks).strip()
            final_session_title = None
            with Session(engine) as session:
                chat_session = session.get(ChatSession, session_id)
                if chat_session:
                    session.add(ChatMessage(session_id=session_id, role="assistant", content=reply))
                    if chat_session.context_type == "report" and chat_session.report_id:
                        linked_report = session.get(Report, chat_session.report_id)
                        if linked_report:
                            chat_session.title = _ensure_unique_title(
                                session,
                                ChatSession,
                                f"{linked_report.title}·关联对话",
                                chat_session.id,
                            )
                    elif should_auto_name_chat:
                        chat_session.title = _ensure_unique_title(
                            session,
                            ChatSession,
                            _safe_chat_title(service, payload.message, reply, chat_session.title),
                            chat_session.id,
                        )
                    chat_session.updated_at = datetime.utcnow()
                    session.add(chat_session)
                    session.commit()
                    final_session_title = chat_session.title
                yield sse_event("done", {"session_id": session_id, "report_id": report_id, "title": final_session_title})
        except Exception as exc:
            yield sse_event("error", _llm_error_payload(exc))

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


@router.get("/chat/sessions", response_model=list[ChatSessionListItem])
def list_chat_sessions(
    query: str | None = Query(default=None),
    context_type: str | None = Query(default=None),
    report_id: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[ChatSessionListItem]:
    statement = select(ChatSession)
    if query:
        statement = statement.where(ChatSession.title.like(f"%{query}%"))
    if context_type:
        statement = statement.where(ChatSession.context_type == context_type)
    if report_id:
        statement = statement.where(ChatSession.report_id == report_id)
    if date_from:
        start = _parse_log_date(date_from)
        statement = statement.where(ChatSession.updated_at >= _day_start(start))
    if date_to:
        end = _parse_log_date(date_to)
        statement = statement.where(ChatSession.updated_at < _day_end(end))
    statement = statement.order_by(ChatSession.updated_at.desc())

    sessions = list(session.exec(statement).all())
    titles = _report_titles(session, {item.report_id for item in sessions if item.report_id})
    return [_chat_session_item(item, titles.get(item.report_id or "")) for item in sessions]


@router.get("/chat/sessions/{session_id}", response_model=ChatSessionDetail)
def get_chat_session(session_id: str, session: Session = Depends(get_session)) -> ChatSessionDetail:
    chat_session = session.get(ChatSession, session_id)
    if not chat_session:
        raise HTTPException(status_code=404, detail="对话不存在")

    messages = list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.session_id == chat_session.id)
            .order_by(ChatMessage.created_at)
        ).all()
    )
    report_title = None
    if chat_session.report_id:
        report = session.get(Report, chat_session.report_id)
        report_title = report.title if report else None
    agent_plans = []
    if chat_session.context_type == "agent":
        agent_plans = list(
            session.exec(
                select(AgentPlan)
                .where(AgentPlan.session_id == chat_session.id)
                .order_by(AgentPlan.created_at)
            ).all()
        )

    return ChatSessionDetail(
        **_chat_session_item(chat_session, report_title).model_dump(),
        messages=[
            ChatMessageItem(
                id=item.id,
                session_id=item.session_id,
                role=item.role,
                content=item.content,
                created_at=item.created_at,
            )
            for item in messages
        ],
        agent_plans=[_agent_plan_item(item) for item in agent_plans],
    )


@router.delete("/chat/sessions/{session_id}", response_model=DeleteResponse)
def delete_chat_session(session_id: str, session: Session = Depends(get_session)) -> DeleteResponse:
    chat_session = session.get(ChatSession, session_id)
    if not chat_session:
        raise HTTPException(status_code=404, detail="对话不存在")
    session.delete(chat_session)
    session.commit()
    return DeleteResponse()


@router.get("/reports", response_model=list[ReportListItem])
def list_reports(
    query: str | None = Query(default=None),
    language_code: str | None = Query(default=None),
    mode: str | None = Query(default=None),
    report_type: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[Report]:
    statement = select(Report)
    if query:
        like = f"%{query}%"
        statement = statement.where(or_(Report.title.like(like), Report.content.like(like)))
    if language_code:
        statement = statement.where(Report.language_code == language_code)
    if mode:
        statement = statement.where(Report.mode == mode)
    if report_type:
        statement = statement.where(Report.report_type == report_type)
    if date_from:
        start = _parse_log_date(date_from)
        statement = statement.where(Report.created_at >= _day_start(start))
    if date_to:
        end = _parse_log_date(date_to)
        statement = statement.where(Report.created_at < _day_end(end))
    statement = statement.order_by(Report.created_at.desc())
    return list(session.exec(statement).all())


@router.get("/reports/{report_id}/outline")
def get_report_outline(report_id: str, session: Session = Depends(get_session)) -> dict:
    report = session.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    return {"report_id": report.id, "outline": parse_report_outline(report.content)}


@router.get("/reports/{report_id}/learning-cards", response_model=list[LearningCardItem])
def get_report_learning_cards(report_id: str, session: Session = Depends(get_session)) -> list[LearningCardItem]:
    report = session.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    cards = list(
        session.exec(
            select(LearningCard)
            .where(LearningCard.source_id == report_id)
            .order_by(LearningCard.created_at.desc())
        ).all()
    )
    return [_learning_card_item(card) for card in cards]


@router.get("/reports/{report_id}", response_model=ReportDetail)
def get_report(report_id: str, session: Session = Depends(get_session)) -> ReportDetail:
    report = session.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")

    metric = session.exec(select(AnalysisMetric).where(AnalysisMetric.report_id == report_id)).first()
    metrics = None
    if metric:
        metrics = {
            "lines": metric.lines,
            "functions": json.loads(metric.functions_json or "{}"),
            "secrets_risk": json.loads(metric.secrets_json or "[]"),
        }
    chat_session = session.exec(
        select(ChatSession)
        .where(ChatSession.report_id == report_id)
        .order_by(ChatSession.updated_at.desc())
    ).first()

    return ReportDetail(
        id=report.id,
        title=report.title,
        report_type=report.report_type,
        mode=report.mode,
        language_label=report.language_label,
        language_code=report.language_code,
        model=report.model,
        created_at=report.created_at,
        code_content=report.code_content,
        code_a=report.code_a,
        code_b=report.code_b,
        content=report.content,
        metrics=metrics,
        chat_session_id=chat_session.id if chat_session else None,
    )


@router.delete("/reports/{report_id}", response_model=DeleteResponse)
def delete_report(report_id: str, session: Session = Depends(get_session)) -> DeleteResponse:
    report = session.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    session.delete(report)
    session.commit()
    return DeleteResponse()

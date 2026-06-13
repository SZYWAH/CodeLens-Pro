from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlmodel import Session, select

from backend.app.config import settings
from backend.app.db import check_database, engine, get_session
from backend.app.models import AnalysisMetric, ChatMessage, ChatSession, Report
from backend.app.schemas import (
    AnalyticsResponse,
    ChatSessionDetail,
    ChatSessionListItem,
    ChatStreamRequest,
    DeleteResponse,
    DiffStreamRequest,
    HealthResponse,
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
        "Cache-Control": "no-cache",
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

    single_reports = [item for item in reports if item.report_type == "single"]
    diff_reports = [item for item in reports if item.report_type == "diff"]
    user_messages = [item for item in chat_messages if item.role == "user"]
    report_chats = [item for item in chat_sessions if item.context_type == "report"]
    general_chats = [item for item in chat_sessions if item.context_type != "report"]

    labels = _mode_labels()
    report_type_counts = [
        {"label": "工作台报告", "value": len(single_reports)},
        {"label": "代码对比报告", "value": len(diff_reports)},
    ]
    chat_type_counts = [
        {"label": "普通对话", "value": len(general_chats)},
        {"label": "报告对话", "value": len(report_chats)},
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

    report_input_tokens = sum(
        count_tokens(item.code_content)
        + count_tokens(item.code_a)
        + count_tokens(item.code_b)
        for item in reports
    )
    report_output_tokens = sum(count_tokens(item.content) for item in reports)
    chat_tokens = sum(count_tokens(item.content) for item in chat_messages)
    total_tokens = report_input_tokens + report_output_tokens + chat_tokens
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
            "report_input_tokens": report_input_tokens,
            "report_output_tokens": report_output_tokens,
            "chat_tokens": chat_tokens,
            "total_tokens": total_tokens,
            "items": [
                {"label": "报告输入", "value": report_input_tokens},
                {"label": "报告输出", "value": report_output_tokens},
                {"label": "AI 对话", "value": chat_tokens},
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
                yield sse_event("error", {"message": f"MySQL 未连接：{mysql_message}"})
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
                yield sse_event("done", {"id": report.id, "title": report.title})
        except Exception as exc:
            yield sse_event("error", {"message": str(exc)})

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


@router.post("/diff/stream")
def stream_diff(payload: DiffStreamRequest) -> StreamingResponse:
    def event_generator():
        chunks: list[str] = []
        try:
            mysql_ok, mysql_message = check_database()
            if not mysql_ok:
                yield sse_event("error", {"message": f"MySQL 未连接：{mysql_message}"})
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
                yield sse_event("done", {"id": report.id, "title": report.title})
        except Exception as exc:
            yield sse_event("error", {"message": str(exc)})

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
                        yield sse_event("error", {"message": "关联报告不存在，无法继续对话。"})
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
            yield sse_event("error", {"message": str(exc)})

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


@router.get("/chat/sessions", response_model=list[ChatSessionListItem])
def list_chat_sessions(
    query: str | None = Query(default=None),
    context_type: str | None = Query(default=None),
    report_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[ChatSessionListItem]:
    statement = select(ChatSession)
    if query:
        statement = statement.where(ChatSession.title.like(f"%{query}%"))
    if context_type:
        statement = statement.where(ChatSession.context_type == context_type)
    if report_id:
        statement = statement.where(ChatSession.report_id == report_id)
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
    statement = statement.order_by(Report.created_at.desc())
    return list(session.exec(statement).all())


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

from __future__ import annotations

import json
import re
from typing import Iterable

from openai import OpenAI

from backend.app.config import settings
from backend.app.services.prompt_service import render_template, resolve_language, resolve_model


GENERIC_TITLE_WORDS = {
    "代码分析报告",
    "代码分析",
    "函数分析",
    "脚本分析",
    "注释解析",
    "设计思路",
    "优化建议",
    "知识点提炼",
    "结构分析",
    "接口整理",
    "复杂度分析",
    "安全检查",
    "整体对比",
    "实现思路",
    "性能对比",
    "质量对比",
    "新的对话",
    "你好",
}


def _clip_text(text: str, limit: int = 2400) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n...（已截断）"


def _file_attention(item: dict) -> str:
    value = str(item.get("attention") or item.get("weight") or "normal").lower()
    return value if value in {"low", "normal", "high"} else "normal"


def _attention_rank(item: dict) -> int:
    return {"high": 2, "normal": 1, "low": 0}[_file_attention(item)]


def _ordered_agent_files(files: list[dict] | None) -> list[dict]:
    return sorted(files or [], key=_attention_rank, reverse=True)


def _compact_text(text: str, limit: int = 28) -> str:
    text = re.sub(r"[#>*`|_\[\]{}()（）【】《》\"'“”‘’]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ：:，,。.;；-—")
    return text[:limit].strip() or ""


def _first_markdown_heading(text: str) -> str:
    for line in text.splitlines():
        heading = line.strip()
        if not heading.startswith("#"):
            continue
        heading = heading.lstrip("#").strip()
        if heading:
            return heading
    return ""


def _parse_json_object(text: str) -> dict:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", candidate, re.IGNORECASE)
    if fenced:
        candidate = fenced.group(1).strip()

    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", candidate)
        if not match:
            raise ValueError("Agent 计划不是有效 JSON")
        value = json.loads(match.group(0))

    if not isinstance(value, dict):
        raise ValueError("Agent 计划必须是 JSON 对象")
    return value


def _extract_code_names(code: str, limit: int = 2) -> list[str]:
    patterns = [
        r"\bdef\s+([A-Za-z_][\w]*)\s*\(",
        r"\bclass\s+([A-Za-z_][\w]*)\s*[:(]",
        r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(",
        r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>",
        r"\b(?:public|private|protected)?\s*(?:static\s+)?[A-Za-z_<>\[\]]+\s+([A-Za-z_][\w]*)\s*\(",
    ]
    names: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, code):
            name = match.group(1)
            if name not in names and name not in {"if", "for", "while", "switch", "return"}:
                names.append(name)
            if len(names) >= limit:
                return names
    return names


def _is_generic_title(title: str) -> bool:
    normalized = _compact_text(title, 40).replace(" ", "")
    if not normalized:
        return True
    return normalized in {item.replace(" ", "") for item in GENERIC_TITLE_WORDS}


def _is_greeting(text: str) -> bool:
    normalized = _compact_text(text, 16).lower().replace(" ", "")
    return normalized in {"你好", "您好", "hello", "hi", "嗨", "在吗"} or normalized.startswith(("你好呀", "您好呀"))


def clean_generated_title(title: str, fallback: str) -> str:
    title = title.strip().splitlines()[0].strip()
    title = title.strip(" #`\"'“”‘’《》")
    for prefix in ("标题：", "标题:", "报告名称：", "报告名称:", "对话名称：", "对话名称:", "名称：", "名称:"):
        if title.startswith(prefix):
            title = title[len(prefix):].strip()
    title = _compact_text(title, 36)
    if not title or _is_generic_title(title) or _is_greeting(title) or title.startswith(("你好", "您好", "很高兴")):
        return fallback
    return title[:36]


def build_report_fallback_title(
    code_context: str,
    report_content: str,
    fallback: str,
    report_type: str = "single",
) -> str:
    code_names = _extract_code_names(code_context)
    if code_names:
        subject = "、".join(code_names)
        suffix = "对比报告" if report_type == "diff" else ("函数分析" if len(code_names) == 1 else "代码分析")
        return f"{subject} {suffix}"[:36]

    heading = _compact_text(_first_markdown_heading(report_content), 28)
    if heading and not _is_generic_title(heading):
        return heading

    summary = _compact_text(report_content, 24)
    if summary and not _is_generic_title(summary):
        return f"{summary}分析"[:36]
    return fallback


def build_chat_fallback_title(user_message: str, assistant_reply: str, fallback: str = "新的对话") -> str:
    heading = _compact_text(_first_markdown_heading(assistant_reply), 28)
    if heading and not _is_generic_title(heading):
        return heading

    question = _compact_text(user_message, 28)
    if _is_greeting(question):
        return "日常问候与使用咨询"
    if question and not _is_generic_title(question):
        return question

    answer = _compact_text(assistant_reply, 24)
    if answer and not _is_generic_title(answer):
        return f"{answer}问答"[:36]
    return fallback


class LLMService:
    def __init__(self, model: str | None = None):
        if not settings.deepseek_api_key:
            raise RuntimeError("DEEPSEEK_API_KEY 未配置，请在 .env 中填写后重启服务。")

        self.model = resolve_model(model or settings.deepseek_default_model)
        self.client = OpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
        )

    def _stream_completion(self, messages: list[dict[str, str]]) -> Iterable[str]:
        stream = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.2,
            stream=True,
        )
        for chunk in stream:
            text = self.extract_stream_text(chunk)
            if text:
                yield text

    def _complete_text(self, messages: list[dict[str, str]], max_tokens: int = 64) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.1,
            max_tokens=max_tokens,
        )
        choices = getattr(response, "choices", None) or []
        if not choices:
            return ""

        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", "") if message else ""
        return content or ""

    @staticmethod
    def extract_stream_text(chunk) -> str:
        try:
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", None)
            if content:
                return content
        except Exception:
            return ""
        return ""

    def stream_report(
        self,
        code: str,
        mode: str,
        language_code: str,
        language_label: str,
    ) -> Iterable[str]:
        language_code, language_label, _ = resolve_language(language_code, language_label)
        prompt_template = render_template(mode, language_code, language_label)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是一个代码分析助手。请基于用户给出的代码直接输出最终报告。"
                    "不要输出开场白、确认语、思考过程或推理过程。回答从第一个 Markdown 标题开始。"
                ),
            },
            {
                "role": "user",
                "content": f"{prompt_template}\n```{language_code}\n{code}\n```",
            },
        ]
        return self._stream_completion(messages)

    def stream_diff(
        self,
        code_a: str,
        code_b: str,
        mode: str,
        language_code: str,
        language_label: str,
    ) -> Iterable[str]:
        language_code, language_label, _ = resolve_language(language_code, language_label)
        prompt_template = render_template(mode, language_code, language_label)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是一个代码对比助手。请基于两个版本代码输出最终对比报告。"
                    "不要输出开场白、确认语、思考过程或推理过程。回答从第一个 Markdown 标题开始。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"{prompt_template}\n\n"
                    f"版本 A：\n```{language_code}\n{code_a}\n```\n\n"
                    f"版本 B：\n```{language_code}\n{code_b}\n```"
                ),
            },
        ]
        return self._stream_completion(messages)

    def stream_chat(
        self,
        message: str,
        history: list[dict[str, str]],
        code_context: str | None = None,
        report_context: str | None = None,
    ) -> Iterable[str]:
        context_parts: list[str] = []
        if code_context and code_context.strip():
            context_parts.append(f"当前代码上下文：\n```\n{code_context}\n```")
        if report_context and report_context.strip():
            context_parts.append(f"当前报告上下文：\n{report_context}")

        system_prompt = (
            "你是 CodeLens 的 AI 助手，回答要简洁、清楚、实用。"
            "不要输出模型推理过程。"
        )
        if context_parts:
            system_prompt += "\n\n" + "\n\n".join(context_parts)

        messages = [
            {"role": "system", "content": system_prompt},
            *history,
            {"role": "user", "content": message},
        ]
        return self._stream_completion(messages)

    def stream_agent_chat(
        self,
        message: str,
        history: list[dict[str, str]],
        code_context: str | None = None,
        report_context: str | None = None,
        files: list[dict] | None = None,
    ) -> Iterable[str]:
        context_parts: list[str] = []
        if code_context and code_context.strip():
            context_parts.append(f"当前代码上下文：\n```\n{_clip_text(code_context, 12000)}\n```")
        if report_context and report_context.strip():
            context_parts.append(f"当前报告上下文：\n{_clip_text(report_context, 6000)}")

        file_sections: list[str] = []
        for index, item in enumerate(_ordered_agent_files(files), start=1):
            item_name = str(item.get("fileName") or item.get("file_name") or f"file-{index}")
            item_path = str(item.get("filePath") or item.get("file_path") or item_name)
            item_language = str(item.get("languageId") or item.get("language_id") or "text")
            item_attention = _file_attention(item)
            item_code = str(item.get("code") or "")
            if not item_code.strip():
                continue
            file_sections.append(
                f"File {index}: {item_name}\nPath: {item_path}\nLanguage: {item_language}\nAttention: {item_attention}\n"
                f"```{item_language}\n{_clip_text(item_code, 9000)}\n```"
            )
        if file_sections:
            context_parts.append("项目文件上下文：\n" + "\n\n".join(file_sections[:12]))

        system_prompt = (
            "你是 CodeLens Pro 的项目级 Agent 助手。"
            "当前处于自由讨论模式，可以分析项目结构、解释代码、定位问题、提出调试和修改建议。"
            "不要直接声称已经修改文件；如果用户明确要求修改文件，请说明可以切换到“计划修改”生成可确认的变更计划。"
            "回答要具体、分点清晰、适合在 VS Code 侧栏阅读，不输出推理过程。"
        )
        if context_parts:
            system_prompt += "\n\n" + "\n\n".join(context_parts)

        messages = [
            {"role": "system", "content": system_prompt},
            *history[-16:],
            {"role": "user", "content": message},
        ]
        return self._stream_completion(messages)

    def select_agent_context_files(
        self,
        instruction: str,
        context_mode: str,
        selected_file_paths: list[str] | None,
        candidates: list[dict] | None,
    ) -> dict:
        compact_candidates: list[dict] = []
        for item in candidates or []:
            path_value = str(item.get("path") or "").replace("\\", "/").strip()
            if not path_value:
                continue
            compact_candidates.append(
                {
                    "path": path_value,
                    "name": str(item.get("name") or "")[:160],
                    "extension": str(item.get("extension") or "")[:24],
                    "language": str(item.get("language") or "")[:48],
                    "size": item.get("size"),
                    "depth": item.get("depth"),
                }
            )
            if len(compact_candidates) >= 500:
                break

        messages = [
            {
                "role": "system",
                "content": (
                    "You choose CodeLens Pro Agent context files. "
                    "You will only receive file metadata, never file contents. "
                    "Return one strict JSON object and nothing else. "
                    "Pick the smallest useful set of workspace-relative paths for the user's task. "
                    "Prefer 5 to 15 files and never more than 20. "
                    "For hybrid mode, always include user_selected paths if they are present in candidates. "
                    "Do not invent paths. Use this schema exactly: "
                    '{"selected_file_paths":["src/file.py"],'
                    '"reasons":[{"path":"src/file.py","reason":"why relevant"}],'
                    '"skipped":[{"path":"src/other.py","reason":"why not needed"}]}.'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User task:\n{instruction}\n\n"
                    f"Context mode: {context_mode}\n"
                    f"User selected paths:\n{json.dumps(selected_file_paths or [], ensure_ascii=False)}\n\n"
                    f"Candidate files:\n{_clip_text(json.dumps(compact_candidates, ensure_ascii=False), 30000)}"
                ),
            },
        ]
        raw = self._complete_text(messages, max_tokens=2200)
        value = _parse_json_object(raw)
        selected = value.get("selected_file_paths")
        reasons = value.get("reasons")
        skipped = value.get("skipped")
        return {
            "selected_file_paths": [str(item).replace("\\", "/") for item in selected if str(item).strip()] if isinstance(selected, list) else [],
            "reasons": reasons if isinstance(reasons, list) else [],
            "skipped": skipped if isinstance(skipped, list) else [],
        }

    def generate_agent_plan(
        self,
        instruction: str,
        code_context: str,
        language_code: str,
        language_label: str,
        file_name: str | None = None,
        file_path: str | None = None,
        report_context: str | None = None,
        files: list[dict] | None = None,
        history: list[dict[str, str]] | None = None,
        previous_plans: list[dict] | None = None,
    ) -> dict:
        file_sections: list[str] = []
        for index, item in enumerate(_ordered_agent_files(files), start=1):
            item_name = str(item.get("fileName") or item.get("file_name") or f"file-{index}")
            item_path = str(item.get("filePath") or item.get("file_path") or item_name)
            item_language = str(item.get("languageId") or item.get("language_id") or "text")
            item_attention = _file_attention(item)
            item_code = str(item.get("code") or "")
            file_sections.append(
                f"File {index}: {item_name}\nPath: {item_path}\nLanguage: {item_language}\nAttention: {item_attention}\n"
                f"```{item_language}\n{_clip_text(item_code, 12000)}\n```"
            )

        context_parts = [
            f"Primary file: {file_name or 'unknown'}",
            f"Primary path: {file_path or 'unknown'}",
            f"Language: {language_label} ({language_code})",
            f"Current code:\n```{language_code}\n{_clip_text(code_context, 18000)}\n```",
        ]
        if file_sections:
            context_parts.append("Additional files:\n" + "\n\n".join(file_sections))
        if report_context:
            context_parts.append(f"Current report context:\n{_clip_text(report_context, 6000)}")
        if history:
            history_text = "\n".join(
                f"{item.get('role', 'message')}: {_clip_text(str(item.get('content') or ''), 1200)}"
                for item in history[-12:]
                if str(item.get("content") or "").strip()
            )
            if history_text:
                context_parts.append(f"Recent Agent conversation:\n{history_text}")
        if previous_plans:
            context_parts.append(
                "Previous Agent plans:\n"
                + _clip_text(json.dumps(previous_plans[-6:], ensure_ascii=False), 6000)
            )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are the planning engine for CodeLens Pro Agent. "
                    "Return one strict JSON object and nothing else. "
                    "Do not apply changes. Produce a reviewable file operation plan. "
                    "All paths must be workspace-relative paths, never absolute paths. "
                    "Allowed operation types are create, update, delete, rename. "
                    "For create and update operations, content must contain the complete final file content. "
                    "For rename operations, include new_path. "
                    "Avoid deleting files unless the user explicitly asks for deletion. "
                    "Use this schema exactly: "
                    '{"summary":"short summary","assumptions":["..."],"warnings":["..."],'
                    '"operations":[{"type":"update","path":"src/file.py","new_path":null,'
                    '"content":"complete file text","reason":"why"}]}.'
                ),
            },
            {
                "role": "user",
                "content": f"User instruction:\n{instruction}\n\nWorkspace context:\n" + "\n\n".join(context_parts),
            },
        ]

        raw = self._complete_text(messages, max_tokens=3200)
        value = _parse_json_object(raw)
        operations = value.get("operations")
        if not isinstance(operations, list):
            operations = []

        normalized_operations: list[dict] = []
        for item in operations:
            if not isinstance(item, dict):
                continue
            operation_type = str(item.get("type") or "").lower()
            path_value = str(item.get("path") or "").strip()
            if operation_type not in {"create", "update", "delete", "rename"} or not path_value:
                continue
            normalized_operations.append(
                {
                    "type": operation_type,
                    "path": path_value.replace("\\", "/"),
                    "new_path": str(item.get("new_path") or "").replace("\\", "/") or None,
                    "content": item.get("content"),
                    "reason": str(item.get("reason") or "").strip() or None,
                }
            )

        return {
            "summary": str(value.get("summary") or instruction).strip()[:500],
            "assumptions": [str(item) for item in value.get("assumptions", []) if str(item).strip()][:12],
            "warnings": [str(item) for item in value.get("warnings", []) if str(item).strip()][:12],
            "operations": normalized_operations[:24],
        }

    def generate_report_title(
        self,
        code_context: str,
        report_content: str,
        fallback: str,
        report_type: str = "single",
    ) -> str:
        smart_fallback = build_report_fallback_title(code_context, report_content, fallback, report_type)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是代码报告命名助手。请根据代码和报告内容生成一个清晰的中文短标题。"
                    "要求：8到18个汉字左右，能区分报告主题；不要使用书名号、引号、句号；"
                    "必须在最终回答内容中只输出标题本身，不要输出解释或思考过程。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"代码摘要：\n{_clip_text(code_context)}\n\n"
                    f"报告摘要：\n{_clip_text(report_content)}"
                ),
            },
        ]
        return clean_generated_title(self._complete_text(messages, max_tokens=256), smart_fallback)

    def generate_chat_title(self, user_message: str, assistant_reply: str, fallback: str) -> str:
        smart_fallback = build_chat_fallback_title(user_message, assistant_reply, fallback)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是对话标题总结助手。请根据一轮用户问题和助手回答生成普通聊天的中文短标题。"
                    "要求：8到16个汉字左右，具体、可辨认；不要输出解释；"
                    "必须在最终回答内容中只输出标题本身。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"用户问题：\n{_clip_text(user_message, 1200)}\n\n"
                    f"助手回答：\n{_clip_text(assistant_reply, 1600)}"
                ),
            },
        ]
        return clean_generated_title(self._complete_text(messages, max_tokens=256), smart_fallback)

    def generate_daily_work_log(self, log_date: str, context_markdown: str, stats: dict) -> str:
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 CodeLens Pro 的每日工作日志整理助手。"
                    "请根据当天使用记录生成一张中文 Markdown 日志卡片。"
                    "风格像开发者日记：克制、具体、可回看，不要夸张，不要编造没有发生的事。"
                    "必须包含这些小节：今日概览、完成事项、AI 对话与报告、Agent 实践、知识卡片与学习、明日建议。"
                    "如果某类记录为空，请简短说明当天没有对应活动。不要输出推理过程。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"日期：{log_date}\n"
                    f"统计：{json.dumps(stats, ensure_ascii=False)}\n\n"
                    f"当天记录：\n{_clip_text(context_markdown, 26000)}"
                ),
            },
        ]
        return self._complete_text(messages, max_tokens=2200)

    def generate_learning_card_material(
        self,
        title: str,
        language_label: str,
        difficulty: str,
        explanation: str,
        tags: list[str],
        code_excerpt: str | None,
        source_links: list[dict],
    ) -> str:
        messages = [
            {
                "role": "system",
                "content": (
                    "你是编程学习资料整理助手。请基于知识卡片信息生成一份中文学习讲解。"
                    "不要复制外部网页正文，不要声称已经浏览网页；只根据卡片内容和给定来源链接做原创解释。"
                    "输出 Markdown，必须严格使用这些二级标题且顺序不变：## 概念解释、## 适用场景、## 最小示例、## 常见误区、## 延伸阅读。"
                    "列表统一使用 - 项目符号；最小示例必须使用 fenced code block，例如 ```python。"
                    "内容要适合初学者，具体、清楚、不要过度学术化。不要输出推理过程。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"知识点：{title}\n"
                    f"语言：{language_label}\n"
                    f"难度：{difficulty}\n"
                    f"标签：{json.dumps(tags, ensure_ascii=False)}\n"
                    f"卡片解释：{_clip_text(explanation, 1600)}\n\n"
                    f"相关代码：\n```\n{_clip_text(code_excerpt or '', 2600)}\n```\n\n"
                    f"来源链接：{json.dumps(source_links, ensure_ascii=False)}"
                ),
            },
        ]
        return self._complete_text(messages, max_tokens=1800)

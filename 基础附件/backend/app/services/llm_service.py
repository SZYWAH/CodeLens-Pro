from __future__ import annotations

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

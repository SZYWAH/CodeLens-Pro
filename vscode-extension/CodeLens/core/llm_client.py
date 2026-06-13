# core/llm_client.py —— 大模型 API 调用封装
from __future__ import annotations

from typing import Any

from openai import OpenAI
import config


class CodeLensAI:
    """
    AI 调用层：
    1. 读取 config.py 中的 API 配置；
    2. 根据前端选择切换模型；
    3. 接收代码语言参数，并把语言信息注入 Prompt；
    4. 返回流式响应。
    """

    def __init__(self, model: str | None = None, provider: str = "DeepSeek"):
        self.provider = provider
        self.model = self._resolve_model(model or getattr(config, "DEFAULT_MODEL", "deepseek-v4-flash"))

        self.client = OpenAI(
            api_key=getattr(config, "API_KEY", ""),
            base_url=getattr(config, "BASE_URL", ""),
        )

    # ============================================================
    #  模型配置
    # ============================================================
    def _resolve_model(self, model: str) -> str:
        """
        将页面展示名转换为真实模型名。

        例如：
        - dsV4flash -> deepseek-v4-flash
        - dsV4pro   -> deepseek-v4-pro

        如果传入的本来就是真实模型名，则直接返回。
        """
        model_options = getattr(config, "MODEL_OPTIONS", {})

        if model in model_options:
            return model_options[model]

        if model in model_options.values():
            return model

        return model

    def set_model(self, model: str):
        """供前端切换模型时调用。"""
        self.model = self._resolve_model(model)

    def get_model(self) -> str:
        """返回当前实际使用的模型名。"""
        return self.model

    def rebuild_client(self):
        """
        如果后续切换供应商、base_url 或 api_key，可以调用这个方法重建客户端。
        目前切换 dsV4pro / dsV4flash 只需要改 self.model，不需要重建 client。
        """
        self.client = OpenAI(
            api_key=getattr(config, "API_KEY", ""),
            base_url=getattr(config, "BASE_URL", ""),
        )

    # ============================================================
    #  语言配置
    # ============================================================
    def _resolve_language(
        self,
        language_code: str | None = None,
        language_label: str | None = None,
    ) -> tuple[str, str, str]:
        """
        返回：language_code, language_label, comment_marker
        """
        language_options = getattr(config, "LANGUAGE_OPTIONS", {
            "Python": "python",
            "Java": "java",
            "JavaScript": "javascript",
            "C++": "cpp",
            "C": "c",
        })
        comment_styles = getattr(config, "COMMENT_STYLE_BY_LANGUAGE", {
            "python": "#",
            "java": "//",
            "javascript": "//",
            "cpp": "//",
            "c": "//",
        })

        if language_label and language_label in language_options:
            code = language_options[language_label]
            label = language_label
        elif language_code:
            code = language_code
            label = next(
                (k for k, v in language_options.items() if v == language_code),
                language_code,
            )
        else:
            label = getattr(config, "DEFAULT_LANGUAGE_LABEL", "Python")
            code = language_options.get(label, "python")

        marker = comment_styles.get(code, "//")
        return code, label, marker

    def _format_prompt_template(
        self,
        template: str,
        language_code: str | None = None,
        language_label: str | None = None,
    ) -> str:
        """向 Prompt 模板中注入语言信息。"""
        code, label, marker = self._resolve_language(language_code, language_label)

        try:
            return template.format(
                language_code=code,
                language_label=label,
                comment_marker=marker,
            )
        except Exception:
            # 如果模板里有未转义的大括号，直接返回原模板，避免程序中断。
            return template

    # ============================================================
    #  内部通用请求方法
    # ============================================================
    def _stream_completion(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> Any:
        """
        统一的流式调用入口。
        所有功能都必须从这里发起请求，避免某个方法继续写死模型名。
        """
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": temperature,
        }

        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        return self.client.chat.completions.create(**kwargs)

    def _get_prompt_template(self, mode: str) -> str:
        """安全读取 Prompt 模板，避免 mode 写错时报 KeyError 不清晰。"""
        templates = getattr(config, "PROMPT_TEMPLATES", {})

        if mode not in templates:
            available = ", ".join(templates.keys())
            raise ValueError(
                f"未知分析模式：{mode}。"
                f"请检查 app.py 中的 mode_map 是否与 config.PROMPT_TEMPLATES 一致。"
                f"当前可用模式：{available}"
            )

        return templates[mode]

    # ============================================================
    #  单代码分析
    # ============================================================
    def stream_audit(
        self,
        code: str,
        mode: str,
        language_code: str = "python",
        language_label: str | None = None,
    ):
        """根据分析模式组装 Prompt，并返回流式结果。"""
        language_code, language_label, _ = self._resolve_language(language_code, language_label)

        system_prompt = (
            "你是一个代码分析助手。"
            f"用户正在分析 {language_label} 代码。"
            "请基于用户给出的代码直接输出分析结果。"
            "不要输出开场白、确认语或过程说明。"
            "不要输出模型推理过程。"
            "回答从第一个 Markdown 标题开始。"
            "如果代码中依赖外部变量、外部函数或外部配置，只说明它依赖外部定义，不要强行猜测。"
        )

        prompt_template = self._format_prompt_template(
            self._get_prompt_template(mode),
            language_code=language_code,
            language_label=language_label,
        )
        user_prompt = f"{prompt_template}\n```{language_code}\n{code}\n```"

        return self._stream_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )

    # ============================================================
    #  独立/单代码对话
    # ============================================================
    def stream_chat(
        self,
        code: str = "",
        chat_history: list[dict[str, str]] | None = None,
        role_hint: str = "AI 助手",
        language_code: str = "python",
        language_label: str | None = None,
    ) -> Any:
        """
        多轮对话。

        兼容两种用法：
        1. code 为空：右侧独立 AI 对话，只根据用户 prompt 回答；
        2. code 非空：带代码上下文的追问。
        """
        chat_history = chat_history or []
        language_code, language_label, _ = self._resolve_language(language_code, language_label)

        if code and code.strip():
            system_prompt = (
                f"你是一个{role_hint}。"
                f"用户正在围绕一段 {language_label} 代码提问。"
                "请基于代码回答，表达直接、清楚、实用。"
                "不要输出模型推理过程。\n\n"
                f"当前代码如下：\n```{language_code}\n{code}\n```"
            )
        else:
            system_prompt = (
                f"你是一个{role_hint}。"
                "这是一个独立对话，不要假设你能看到左侧代码或中间报告。"
                "只根据用户在对话框里输入的内容回答。"
                "回答要简洁、清楚、实用。"
                "不要输出模型推理过程。"
            )

        messages = [
            {"role": "system", "content": system_prompt},
            *chat_history,
        ]

        return self._stream_completion(messages=messages)

    # ============================================================
    #  双代码对比分析
    # ============================================================
    def stream_diff(
        self,
        code_a: str,
        code_b: str,
        mode: str,
        language_code: str = "python",
        language_label: str | None = None,
    ):
        """以两份代码作为输入，进行对比分析并返回流式结果。"""
        language_code, language_label, _ = self._resolve_language(language_code, language_label)

        system_prompt = (
            "你是一个代码对比助手。"
            f"用户正在比较两个版本的 {language_label} 代码。"
            "请基于用户给出的两个版本代码进行比较。"
            "不要输出开场白、确认语或过程说明。"
            "不要输出模型推理过程。"
            "回答从第一个 Markdown 标题开始。"
        )

        prompt_template = self._format_prompt_template(
            self._get_prompt_template(mode),
            language_code=language_code,
            language_label=language_label,
        )
        user_prompt = (
            f"{prompt_template}\n\n"
            f"版本 A：\n```{language_code}\n{code_a}\n```\n\n"
            f"版本 B：\n```{language_code}\n{code_b}\n```"
        )

        return self._stream_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )

    # ============================================================
    #  双代码对话
    # ============================================================
    def stream_diff_chat(
        self,
        code_a: str,
        code_b: str,
        chat_history: list[dict[str, str]] | None = None,
        language_code: str = "python",
        language_label: str | None = None,
    ) -> Any:
        """以两份代码为上下文，进行多轮对比对话。"""
        chat_history = chat_history or []
        language_code, language_label, _ = self._resolve_language(language_code, language_label)

        system_prompt = (
            "你是一个代码对比助手。"
            f"用户正在比较两个版本的 {language_label} 代码。"
            "请基于两个版本回答问题，表达直接、清楚、实用。"
            "不要输出模型推理过程。\n\n"
            f"版本 A：\n```{language_code}\n{code_a}\n```\n\n"
            f"版本 B：\n```{language_code}\n{code_b}\n```"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            *chat_history,
        ]

        return self._stream_completion(messages=messages)

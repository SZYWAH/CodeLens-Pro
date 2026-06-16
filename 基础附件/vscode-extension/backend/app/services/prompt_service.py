from __future__ import annotations

from CodeLens import config as legacy_config


MODEL_OPTIONS: dict[str, str] = getattr(
    legacy_config,
    "MODEL_OPTIONS",
    {"DeepSeek-V4-Flash": "deepseek-v4-flash", "DeepSeek-V4-Pro": "deepseek-v4-pro"},
)

MODEL_LABEL_ALIASES = {
    "dsV4flash": "DeepSeek-V4-Flash",
    "dsV4pro": "DeepSeek-V4-Pro",
}

MODEL_OPTIONS = {
    MODEL_LABEL_ALIASES.get(label, label): model_id
    for label, model_id in MODEL_OPTIONS.items()
}

LANGUAGE_OPTIONS: dict[str, str] = getattr(
    legacy_config,
    "LANGUAGE_OPTIONS",
    {
        "Python": "python",
        "Java": "java",
        "JavaScript": "javascript",
        "C++": "cpp",
        "C": "c",
    },
)

COMMENT_STYLE_BY_LANGUAGE: dict[str, str] = getattr(
    legacy_config,
    "COMMENT_STYLE_BY_LANGUAGE",
    {"python": "#", "java": "//", "javascript": "//", "cpp": "//", "c": "//"},
)

PROMPT_TEMPLATES: dict[str, str] = getattr(legacy_config, "PROMPT_TEMPLATES", {})


REPORT_MODES = {
    "function": [
        {"id": "func_comment", "label": "注释解析"},
        {"id": "func_design", "label": "设计思路"},
        {"id": "func_optimize", "label": "优化建议"},
        {"id": "func_trace", "label": "代码运行推演"},
    ],
    "script": [
        {"id": "script_structure", "label": "结构分析"},
        {"id": "script_api", "label": "接口整理"},
        {"id": "script_complexity", "label": "复杂度分析"},
        {"id": "script_security", "label": "安全检查"},
    ],
    "diff": [
        {"id": "diff_overview", "label": "整体对比"},
        {"id": "diff_approach", "label": "实现思路"},
        {"id": "diff_performance", "label": "性能对比"},
        {"id": "diff_quality", "label": "质量对比"},
    ],
}


MODE_TITLES = {
    item["id"]: item["label"]
    for modes in REPORT_MODES.values()
    for item in modes
}


def resolve_language(language_code: str | None = None, language_label: str | None = None) -> tuple[str, str, str]:
    if language_label and language_label in LANGUAGE_OPTIONS:
        code = LANGUAGE_OPTIONS[language_label]
        label = language_label
    elif language_code:
        code = language_code
        label = next((key for key, value in LANGUAGE_OPTIONS.items() if value == code), code)
    else:
        label = "Python"
        code = "python"

    marker = COMMENT_STYLE_BY_LANGUAGE.get(code, "//")
    return code, label, marker


def resolve_model(model: str | None) -> str:
    if not model:
        return MODEL_OPTIONS.get("DeepSeek-V4-Flash", "deepseek-v4-flash")
    normalized = MODEL_LABEL_ALIASES.get(model, model)
    if normalized in MODEL_OPTIONS:
        return MODEL_OPTIONS[normalized]
    if normalized in MODEL_OPTIONS.values():
        return normalized
    return normalized


def report_title(mode: str) -> str:
    return MODE_TITLES.get(mode, "代码分析报告")


def render_template(mode: str, language_code: str, language_label: str) -> str:
    if mode not in PROMPT_TEMPLATES:
        available = ", ".join(sorted(PROMPT_TEMPLATES.keys()))
        raise ValueError(f"未知分析模式：{mode}。可用模式：{available}")

    code, label, marker = resolve_language(language_code, language_label)
    template = PROMPT_TEMPLATES[mode]
    return template.format(
        language_code=code,
        language_label=label,
        comment_marker=marker,
    )

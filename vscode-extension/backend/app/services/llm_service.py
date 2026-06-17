from __future__ import annotations

import json
import re
from typing import Iterable

from openai import OpenAI

from backend.app.config import settings
from backend.app.services.llm_settings_service import effective_deepseek_base_url, effective_deepseek_key
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
    "代码运行推演",
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


def _looks_like_edit_instruction(instruction: str) -> bool:
    return bool(
        re.search(
            r"(add|create|update|modify|rewrite|optimi[sz]e|remove|delete|rename|insert|append|"
            r"implement|添加|新增|增加|修改|更新|优化|删除|移除|重命名|插入|补充|创建|新建|实现|落地|生成|编写|引入|替换|代替|记录)",
            instruction or "",
            re.IGNORECASE,
        )
    )


def _looks_like_followup_apply_instruction(instruction: str) -> bool:
    return bool(
        re.search(
            r"(落实|执行|应用|按上面|按刚才|按这个|就这样|继续改|帮我改|apply|execute|implement|do it)",
            instruction or "",
            re.IGNORECASE,
        )
    )


def _quick_start_readme_operation(instruction: str, files: list[dict] | None, code_context: str) -> dict | None:
    if not re.search(r"(quick\s*start|快速开始|快速上手|开始使用)", instruction or "", re.IGNORECASE):
        return None

    candidates = _ordered_agent_files(files)
    target = next(
        (
            item
            for item in candidates
            if str(item.get("filePath") or item.get("file_path") or item.get("fileName") or "").lower().endswith((".md", ".markdown"))
        ),
        None,
    )
    path = str((target or {}).get("filePath") or (target or {}).get("file_path") or (target or {}).get("fileName") or "README.md")
    name = str((target or {}).get("fileName") or (target or {}).get("file_name") or path)
    content = str((target or {}).get("code") or code_context or "").strip()
    if not content or not path.lower().endswith((".md", ".markdown")):
        return None
    if re.search(r"^#{1,3}\s*(快速开始|快速上手|Quick Start)", content, re.IGNORECASE | re.MULTILINE):
        return None

    section = (
        "\n\n## 快速开始\n\n"
        "1. 克隆或下载本项目到本地。\n"
        "2. 根据 `.env.example` 配置数据库和模型 API Key。\n"
        "3. 启动后端服务，并确认 MySQL 连接正常。\n"
        "4. 启动前端页面，进入代码工作台或 Agent 工作区体验核心流程。\n"
        "5. 如需使用插件协作能力，请在 VS Code 中安装并连接 CodeLens Pro 插件。\n"
    )
    insert_match = re.search(r"\n##\s+(功能|核心|项目|安装|环境|技术|架构|目录|使用)", content)
    if insert_match:
        new_content = content[: insert_match.start()] + section + content[insert_match.start():]
    else:
        new_content = content.rstrip() + section + "\n"

    return {
        "type": "update",
        "path": path.replace("\\", "/"),
        "new_path": None,
        "content": new_content,
        "reason": f"根据任务在 {name} 中补充快速开始板块，方便新用户按步骤启动和体验项目。",
    }


def _contains_any_term(text: str | None, terms: tuple[str, ...]) -> bool:
    normalized = str(text or "").lower()
    return any(term.lower() in normalized for term in terms)


def _safe_quick_start_readme_operation(
    instruction: str,
    files: list[dict] | None,
    code_context: str,
    *,
    history: list[dict[str, str]] | None = None,
    force: bool = False,
) -> dict | None:
    quick_start_terms = ("\u5feb\u901f\u5f00\u59cb", "\u5feb\u901f\u4e0a\u624b", "\u5f00\u59cb\u4f7f\u7528", "quick start")
    advice_terms = ("\u5efa\u8bae", "\u4f60\u7684\u5efa\u8bae", "\u4e0a\u9762", "\u521a\u624d", "suggestion")
    history_text = "\n".join(str(item.get("content") or "") for item in (history or [])[-6:])
    should_apply = (
        force
        or _contains_any_term(instruction, quick_start_terms)
        or (_contains_any_term(instruction, advice_terms) and _contains_any_term(history_text, quick_start_terms))
    )
    if not should_apply:
        return None

    candidates = _ordered_agent_files(files)
    target = next(
        (
            item
            for item in candidates
            if str(item.get("filePath") or item.get("file_path") or item.get("fileName") or "").lower().endswith((".md", ".markdown"))
        ),
        None,
    )
    path = str((target or {}).get("filePath") or (target or {}).get("file_path") or (target or {}).get("fileName") or "README.md")
    name = str((target or {}).get("fileName") or (target or {}).get("file_name") or path)
    content = str((target or {}).get("code") or code_context or "").strip()
    if not content or not path.lower().endswith((".md", ".markdown")):
        return None
    if re.search(r"^#{1,3}\s*(\u5feb\u901f\u5f00\u59cb|\u5feb\u901f\u4e0a\u624b|Quick Start)", content, re.IGNORECASE | re.MULTILINE):
        return None

    section = (
        "\n\n## \u5feb\u901f\u5f00\u59cb\n\n"
        "1. \u514b\u9686\u6216\u4e0b\u8f7d\u672c\u9879\u76ee\u5230\u672c\u5730\u3002\n"
        "2. \u6839\u636e `.env.example` \u914d\u7f6e\u6570\u636e\u5e93\u548c\u6a21\u578b API Key\u3002\n"
        "3. \u542f\u52a8\u540e\u7aef\u670d\u52a1\uff0c\u5e76\u786e\u8ba4 MySQL \u8fde\u63a5\u6b63\u5e38\u3002\n"
        "4. \u542f\u52a8\u524d\u7aef\u9875\u9762\uff0c\u8fdb\u5165\u4ee3\u7801\u5de5\u4f5c\u53f0\u6216 Agent \u5de5\u4f5c\u533a\u4f53\u9a8c\u6838\u5fc3\u6d41\u7a0b\u3002\n"
        "5. \u5982\u9700\u4f7f\u7528\u63d2\u4ef6\u534f\u4f5c\u80fd\u529b\uff0c\u8bf7\u5728 VS Code \u4e2d\u5b89\u88c5\u5e76\u8fde\u63a5 CodeLens Pro \u63d2\u4ef6\u3002\n"
    )
    insert_match = re.search(r"\n##\s+(\u529f\u80fd|\u6838\u5fc3|\u9879\u76ee|\u5b89\u88c5|\u73af\u5883|\u6280\u672f|\u67b6\u6784|\u76ee\u5f55|\u4f7f\u7528)", content)
    if insert_match:
        new_content = content[: insert_match.start()] + section + content[insert_match.start():]
    else:
        new_content = content.rstrip() + section + "\n"

    return {
        "type": "update",
        "path": path.replace("\\", "/"),
        "new_path": None,
        "content": new_content,
        "reason": f"\u6839\u636e\u4efb\u52a1\u5728 {name} \u4e2d\u8865\u5145\u5feb\u901f\u5f00\u59cb\u677f\u5757\uff0c\u65b9\u4fbf\u65b0\u7528\u6237\u6309\u6b65\u9aa4\u542f\u52a8\u548c\u4f53\u9a8c\u9879\u76ee\u3002",
    }


def _agent_history_text(history: list[dict[str, str]] | None, limit: int = 6) -> str:
    return "\n".join(str(item.get("content") or "") for item in (history or [])[-limit:])


def _looks_like_reproduce_doc_instruction(instruction: str, history: list[dict[str, str]] | None = None) -> bool:
    instruction_text = str(instruction or "")
    history_text = _agent_history_text(history)
    combined = f"{instruction_text}\n{history_text}".lower()
    reproduce_terms = (
        "复现",
        "可复现",
        "复现实验",
        "从零运行",
        "reproduce",
        "reproducible",
        "run_experiment",
    )
    if any(term.lower() in combined for term in reproduce_terms):
        return True

    followup_terms = (
        "这一点不错",
        "这点不错",
        "这个不错",
        "按这个",
        "就这个",
        "采纳",
        "帮我实现",
        "实现一下",
        "落地",
        "do it",
        "implement it",
    )
    return any(term.lower() in instruction_text.lower() for term in followup_terms) and any(
        term.lower() in history_text.lower() for term in reproduce_terms
    )


def _file_identity_text(item: dict) -> str:
    return " ".join(
        str(item.get(key) or "")
        for key in ("fileName", "file_name", "filePath", "file_path", "languageId", "language_id")
    )


def _looks_like_openalex_context(files: list[dict] | None, code_context: str) -> bool:
    chunks = [str(code_context or "")]
    for item in files or []:
        chunks.append(_file_identity_text(item))
        chunks.append(_clip_text(str(item.get("code") or ""), 3000))
    text = "\n".join(chunks).lower()
    if "openalex" not in text:
        return False
    return any(
        term in text
        for term in (
            "openalex-mcp",
            "modelscope-openalex",
            "build_openalex_docx",
            "mcp-call-records",
            "parameter-summary",
            "openalex api",
        )
    )


def _first_context_path(files: list[dict] | None, predicates: tuple[str, ...], fallback: str) -> str:
    for item in files or []:
        path_value = str(item.get("filePath") or item.get("file_path") or item.get("fileName") or "").replace("\\", "/")
        lower_path = path_value.lower()
        if path_value and any(predicate.lower() in lower_path for predicate in predicates):
            return path_value
    return fallback


def _build_openalex_reproduce_markdown(files: list[dict] | None) -> str:
    report_path = _first_context_path(files, (".md",), "OpenAlex-MCP实验报告.md")
    config_path = _first_context_path(files, ("modelscope-openalex-mcp.json",), "modelscope-openalex-mcp.json")
    script_path = _first_context_path(files, ("build_openalex_docx.py",), "build_openalex_docx.py")
    return (
        "# OpenAlex MCP 实验复现说明\n\n"
        "本文档用于从零复现 OpenAlex MCP 实验，包括 MCP 配置、工具调用验证、结果留存和报告生成。\n\n"
        "## 1. 环境准备\n\n"
        "- 准备可访问外网的本地环境，确认可以访问 `https://api.openalex.org`。\n"
        "- 安装 Node.js 18 或更高版本，用于运行 OpenAlex MCP Server。\n"
        "- 安装 Python 3.10 或更高版本，用于生成 Word 报告。\n"
        "- 如需生成 `.docx`，先安装脚本依赖：`pip install python-docx`。\n\n"
        "## 2. MCP 配置\n\n"
        f"- 查看 `{config_path}`，确认 OpenAlex MCP Server 的包名、启动命令和环境变量。\n"
        "- 将配置写入 Codex Desktop 或目标 MCP Client 的 MCP 配置文件。\n"
        "- 重启客户端后，确认工具列表中可以看到 OpenAlex 相关工具。\n\n"
        "## 3. 调用链验证\n\n"
        "- 执行一次初始化检查，确认 JSON-RPC `initialize` 返回成功。\n"
        "- 执行 `tools/list`，保存工具列表返回结果。\n"
        "- 分别使用 keyword、semantic、exact 三种检索模式发起 `tools/call`。\n"
        "- 将关键请求和响应保存到 `artifacts/mcp-call-records.json`。\n\n"
        "## 4. 实验结果复现\n\n"
        "- 按报告中的问题重新检索：LLM Agent 辅助自动化文献综述和科研发现。\n"
        "- 保存 semantic search 的 Top 1 完整结果到 `artifacts/openalex-top-result.json`。\n"
        "- 保存三种模式的 Top 3 对比结果到 `artifacts/parameter-summary.json`。\n"
        "- 截图保存到 `screenshots/`，文件名保持和报告引用一致。\n\n"
        "## 5. 报告生成\n\n"
        f"- 检查 Markdown 报告 `{report_path}` 是否引用了最新 artifacts 和 screenshots。\n"
        f"- 运行 `python {script_path}` 生成 Word 版报告。\n"
        "- 生成后检查 `docx_a11y_report.json`，确认高、中、低优先级问题均为 0。\n\n"
        "## 6. 验收清单\n\n"
        "- `artifacts/mcp-call-records.json` 包含 initialize、tools/list、tools/call 记录。\n"
        "- `artifacts/openalex-top-result.json` 包含论文标题、作者、机构、年份、引用量和 DOI。\n"
        "- `artifacts/parameter-summary.json` 能对比 keyword、semantic、exact 三种模式。\n"
        "- `screenshots/` 中截图能对应报告中的配置、工具调用和返回结果。\n"
        "- Word 版报告已重新生成，且无障碍检查通过。\n\n"
        "## 7. 常见问题\n\n"
        "- 如果工具列表为空，优先检查 MCP 配置路径、Node.js 版本和包名是否正确。\n"
        "- 如果检索结果偏离主题，优先改用 semantic 模式，并收窄查询词。\n"
        "- 如果 Word 生成失败，确认 Python 依赖已安装，并检查截图路径是否存在。\n"
    )


def _openalex_reproduce_doc_operation(
    instruction: str,
    files: list[dict] | None,
    code_context: str,
    *,
    history: list[dict[str, str]] | None = None,
) -> dict | None:
    if not _looks_like_reproduce_doc_instruction(instruction, history):
        return None
    if not _looks_like_openalex_context(files, code_context):
        return None
    return {
        "type": "create",
        "path": "reproduce.md",
        "new_path": None,
        "content": _build_openalex_reproduce_markdown(files),
        "reason": "为 OpenAlex MCP 实验补充可复现说明，方便按同一配置和数据留存路径复跑实验。",
    }


def _looks_like_readme_doc_instruction(instruction: str, history: list[dict[str, str]] | None = None) -> bool:
    instruction_text = str(instruction or "")
    history_text = _agent_history_text(history)
    combined = f"{instruction_text}\n{history_text}".lower()
    readme_terms = (
        "readme",
        "README".lower(),
        "项目说明",
        "说明文档",
        "使用说明",
        "项目文档",
        "项目介绍",
        "文档说明",
    )
    if any(term.lower() in combined for term in readme_terms):
        return True

    followup_terms = (
        "这一点不错",
        "这点不错",
        "这个不错",
        "按这个",
        "就这个",
        "采纳",
        "帮我实现",
        "实现一下",
        "落地",
        "do it",
        "implement it",
    )
    return any(term.lower() in instruction_text.lower() for term in followup_terms) and any(
        term.lower() in history_text.lower()
        for term in ("readme", "项目说明", "说明文档", "使用说明", "项目文档")
    )


def _context_file_path(item: dict) -> str:
    return str(item.get("filePath") or item.get("file_path") or item.get("fileName") or item.get("file_name") or "").replace("\\", "/")


def _context_file_content(files: list[dict] | None, path_suffix: str) -> str:
    suffix = path_suffix.lower()
    for item in files or []:
        path_value = _context_file_path(item).lower()
        if path_value.endswith(suffix):
            return str(item.get("code") or "")
    return ""


def _context_has_path(files: list[dict] | None, *suffixes: str) -> bool:
    normalized_suffixes = tuple(suffix.lower() for suffix in suffixes)
    return any(_context_file_path(item).lower().endswith(normalized_suffixes) for item in files or [])


def _infer_readme_project_title(files: list[dict] | None, code_context: str) -> str:
    text = "\n".join(
        [
            str(code_context or ""),
            "\n".join(_file_identity_text(item) for item in files or []),
            _context_file_content(files, "docker-compose.yml"),
            _context_file_content(files, "Dockerfile"),
        ]
    ).lower()
    if "streamlit" in text and any(term in text for term in ("bertopic", "sentence-transformers", "hdbscan", "umap")):
        return "机器学习课堂展示"
    if "streamlit" in text:
        return "Streamlit 数据分析应用"
    return "项目说明"


def _readme_feature_lines(files: list[dict] | None, code_context: str) -> list[str]:
    text_parts = [str(code_context or "")]
    for item in files or []:
        text_parts.append(_file_identity_text(item))
        text_parts.append(_clip_text(str(item.get("code") or ""), 2400))
    text = "\n".join(text_parts).lower()
    features: list[str] = []
    if "streamlit" in text:
        features.append("基于 Streamlit 提供交互式 Web 页面，适合课堂演示和快速验证分析流程。")
    if any(term in text for term in ("bertopic", "sentence-transformers", "hdbscan", "umap", "gensim")):
        features.append("集成主题建模、文本嵌入、降维和聚类等机器学习/NLP 能力。")
    if any(term in text for term in ("feedparser", "rss", "openalex", "arxiv")):
        features.append("支持从 RSS、OpenAlex、arXiv 等数据源采集或整理文献与资讯数据。")
    if any(term in text for term in ("plotly", "pandas")):
        features.append("使用 Pandas 与 Plotly 完成数据处理、统计汇总和可视化展示。")
    if any(term in text for term in ("selenium", "chromium", "chromedriver")):
        features.append("包含 Selenium/Chromium 自动化能力，可用于动态页面抓取或页面渲染。")
    if any(term in text for term in ("pymysql", "dbutils", "mysql")):
        features.append("提供 MySQL 连接与连接池能力，用于持久化业务数据。")
    if any(term in text for term in ("xhtml2pdf", "markdown", "exports")):
        features.append("支持将分析结果导出为 Markdown、PDF 或其他报告文件。")
    if _context_has_path(files, "Dockerfile", "docker-compose.yml"):
        features.append("提供 Docker/Docker Compose 配置，便于在一致环境中部署运行。")
    return features or ["整理项目结构、运行方式和常见配置，方便新用户快速理解并启动项目。"]


def _readme_structure_lines(files: list[dict] | None) -> list[str]:
    paths: list[str] = []
    for item in files or []:
        path_value = _context_file_path(item)
        if not path_value:
            continue
        if path_value not in paths:
            paths.append(path_value)
    preferred = [
        "app17.py",
        "config.py",
        ".env.example",
        ".env",
        "Dockerfile",
        "docker-compose.yml",
        "requirements.txt",
        "requirements-base.txt",
        "requirements-ml.txt",
        "openalex_crawler.py",
        "arxiv_crawler.py",
    ]
    ordered: list[str] = []
    lower_paths = {path.lower(): path for path in paths}
    for name in preferred:
        if name.lower() in lower_paths:
            ordered.append(lower_paths[name.lower()])
    for path in paths:
        if path not in ordered and len(ordered) < 18:
            ordered.append(path)

    descriptions = {
        "app17.py": "Streamlit 主入口，负责页面交互与核心业务流程。",
        "config.py": "集中管理配置读取、数据库或模型参数等运行配置。",
        ".env.example": "环境变量示例文件，可复制为本地 `.env` 后填写真实配置。",
        ".env": "本地环境变量文件，通常不应提交到版本库。",
        "Dockerfile": "容器镜像构建文件。",
        "docker-compose.yml": "本地编排配置，可一键启动相关服务。",
        "requirements.txt": "Python 依赖列表。",
        "requirements-base.txt": "基础运行依赖列表。",
        "requirements-ml.txt": "机器学习/NLP 相关依赖列表。",
        "openalex_crawler.py": "OpenAlex 数据采集或检索脚本。",
        "arxiv_crawler.py": "arXiv 数据采集或检索脚本。",
    }
    lines: list[str] = []
    for path in ordered:
        key = path.rsplit("/", 1)[-1]
        description = descriptions.get(key, "项目文件。")
        lines.append(f"- `{path}`：{description}")
    return lines or ["- `app17.py`：应用入口文件。", "- `requirements*.txt`：Python 依赖配置。"]


def _build_project_readme_markdown(files: list[dict] | None, code_context: str) -> str:
    title = _infer_readme_project_title(files, code_context)
    has_base_requirements = _context_has_path(files, "requirements-base.txt")
    has_ml_requirements = _context_has_path(files, "requirements-ml.txt")
    has_requirements = _context_has_path(files, "requirements.txt")
    has_compose = _context_has_path(files, "docker-compose.yml")
    has_dockerfile = _context_has_path(files, "Dockerfile")
    has_env_example = _context_has_path(files, ".env.example", ".env.docker.example")
    has_app17 = _context_has_path(files, "app17.py")

    install_commands: list[str] = ["python -m venv .venv"]
    install_commands.append(".\\.venv\\Scripts\\activate")
    install_commands.append("python -m pip install --upgrade pip")
    if has_base_requirements:
        install_commands.append("pip install -r requirements-base.txt")
    if has_ml_requirements:
        install_commands.append("pip install -r requirements-ml.txt")
    if has_requirements and not (has_base_requirements or has_ml_requirements):
        install_commands.append("pip install -r requirements.txt")
    run_command = "streamlit run app17.py --server.port 8501" if has_app17 else "streamlit run <入口文件>.py"
    docker_commands = ["docker compose up --build"] if has_compose else ["docker build -t ml-class-demo .", "docker run --rm -p 8501:8501 --env-file .env ml-class-demo"]
    env_hint = (
        "复制 `.env.example` 或 `.env.docker.example` 为 `.env`，再填写数据库、模型服务、API Key 等本地配置。"
        if has_env_example
        else "根据 `config.py` 或部署环境要求准备 `.env`，不要把包含真实密钥的 `.env` 提交到版本库。"
    )

    return (
        f"# {title}\n\n"
        "本项目是一个面向课堂展示和实验验证的数据分析应用，围绕文本采集、自然语言处理、机器学习建模、可视化展示和报告导出组织代码。"
        "README 用于说明项目结构、环境准备、运行方式和常见问题，方便从零启动或继续维护。\n\n"
        "## 功能特性\n\n"
        + "\n".join(f"- {line}" for line in _readme_feature_lines(files, code_context))
        + "\n\n"
        "## 技术栈\n\n"
        "- Python 3.10+\n"
        "- Streamlit\n"
        "- Pandas / Plotly\n"
        "- BERTopic / Sentence-Transformers / UMAP / HDBSCAN / Gensim（如安装了机器学习依赖）\n"
        "- MySQL / PyMySQL / DBUtils（如启用数据库功能）\n"
        "- Selenium / Chromium（如启用动态页面采集或渲染）\n"
        "- Docker / Docker Compose\n\n"
        "## 项目结构\n\n"
        + "\n".join(_readme_structure_lines(files))
        + "\n\n"
        "## 环境准备\n\n"
        "1. 安装 Python 3.10 或更高版本。\n"
        "2. 准备可用的数据库和外部 API 配置（如项目功能需要）。\n"
        f"3. {env_hint}\n"
        "4. 如需运行 Docker 版本，请先安装 Docker Desktop 或兼容的 Docker 环境。\n\n"
        "## 本地运行\n\n"
        "```powershell\n"
        + "\n".join(install_commands)
        + f"\n{run_command}\n"
        "```\n\n"
        "启动后在浏览器打开 Streamlit 输出的本地地址，默认通常为 `http://localhost:8501`。\n\n"
        + (
            "## Docker 运行\n\n"
            "```powershell\n"
            + "\n".join(docker_commands)
            + "\n```\n\n"
            "如果需要持久化导出文件，建议在运行容器时挂载本地目录到应用的导出目录。\n\n"
            if has_dockerfile or has_compose
            else ""
        )
        + "## 配置说明\n\n"
        "- `.env`：本地真实配置文件，可能包含数据库密码、API Key 等敏感信息，请勿提交。\n"
        "- `.env.example` / `.env.docker.example`：推荐维护的配置模板，供新环境复制使用。\n"
        "- `config.py`：建议集中读取环境变量并设置默认值，避免在业务代码中硬编码配置。\n\n"
        "## 数据与导出\n\n"
        "- 数据采集脚本可按需从 OpenAlex、arXiv、RSS 或其他来源拉取内容。\n"
        "- 分析结果建议输出到统一的 `data/`、`exports/` 或项目约定目录中。\n"
        "- 大文件、临时文件和包含敏感信息的数据应通过 `.gitignore` 排除。\n\n"
        "## 常见问题\n\n"
        "- 依赖安装失败：优先确认 Python 版本和系统编译环境，机器学习依赖可单独安装排查。\n"
        "- 页面无法打开：确认 Streamlit 进程已启动，并检查端口是否被占用。\n"
        "- 数据库连接失败：检查 `.env` 中的主机、端口、用户名、密码和数据库名。\n"
        "- Docker 内浏览器相关功能异常：确认镜像中已安装 Chromium、chromedriver 和必要字体/系统库。\n\n"
        "## 维护建议\n\n"
        "- 依赖版本变更后同步更新 requirements 文件和 Docker 构建逻辑。\n"
        "- 新增采集源、模型或导出格式时，在 README 中补充配置项和运行示例。\n"
        "- 课堂展示前建议完整跑通一次本地运行、Docker 运行和核心分析流程。\n"
    )


def _project_readme_doc_operation(
    instruction: str,
    files: list[dict] | None,
    code_context: str,
    *,
    history: list[dict[str, str]] | None = None,
) -> dict | None:
    if not _looks_like_readme_doc_instruction(instruction, history):
        return None
    existing_readme = next(
        (
            item
            for item in files or []
            if _context_file_path(item).lower().rsplit("/", 1)[-1] in {"readme.md", "readme.markdown"}
        ),
        None,
    )
    path = _context_file_path(existing_readme) if existing_readme else "README.md"
    return {
        "type": "update" if existing_readme else "create",
        "path": path or "README.md",
        "new_path": None,
        "content": _build_project_readme_markdown(files, code_context),
        "reason": "根据当前项目结构补充 README 项目说明，方便了解功能、依赖、配置和运行方式。",
    }


def _normalize_agent_operation_path(path_value: str, selected_file_paths: list[str]) -> str:
    normalized = str(path_value or "").strip().replace("\\", "/")
    selected = [str(item or "").strip().replace("\\", "/") for item in selected_file_paths if str(item or "").strip()]
    if selected:
        filename = normalized.rsplit("/", 1)[-1].lower()
        for selected_path in selected:
            if selected_path.lower() == normalized.lower():
                return selected_path
        for selected_path in selected:
            if selected_path.rsplit("/", 1)[-1].lower() == filename:
                return selected_path

    drive_match = re.search(r"^[A-Za-z]:/(.+)$", normalized)
    if drive_match:
        normalized = drive_match.group(1)
    return normalized.lstrip("/")


def _normalize_agent_operation_edits(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    edits: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        search = str(item.get("search") or "")
        replace = str(item.get("replace") or "")
        if not search:
            continue
        edits.append({"search": search, "replace": replace})
        if len(edits) >= 20:
            break
    return edits


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
    candidate = str(text or "").lstrip("\ufeff").strip()
    if not candidate:
        raise ValueError("Agent 计划不是有效 JSON")
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", candidate, re.IGNORECASE)
    if fenced:
        candidate = fenced.group(1).lstrip("\ufeff").strip()

    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        value = None
        for match in re.finditer(r"\{", candidate):
            try:
                decoded, _ = decoder.raw_decode(candidate[match.start():])
            except json.JSONDecodeError:
                continue
            if isinstance(decoded, dict):
                value = decoded
                break
        if value is None:
            raise ValueError("Agent 计划不是有效 JSON")

    if not isinstance(value, dict):
        raise ValueError("Agent 计划必须是 JSON 对象")
    return value


def _parse_json_array_or_object(text: str) -> list:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", candidate, re.IGNORECASE)
    if fenced:
        candidate = fenced.group(1).strip()

    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        array_match = re.search(r"\[[\s\S]*\]", candidate)
        object_match = re.search(r"\{[\s\S]*\}", candidate)
        if array_match:
            value = json.loads(array_match.group(0))
        elif object_match:
            value = json.loads(object_match.group(0))
        else:
            raise ValueError("知识卡片候选不是有效 JSON")

    if isinstance(value, dict):
        for key in ("cards", "candidates", "knowledge_points"):
            nested = value.get(key)
            if isinstance(nested, list):
                return nested
        return []
    if isinstance(value, list):
        return value
    raise ValueError("知识卡片候选必须是 JSON 数组")


def _log_agent_plan_json_failure(stage: str, raw: str, exc: Exception) -> None:
    preview = _clip_text(str(raw or "").replace("\r\n", "\n"), 1200)
    print(f"[agent-plan-json] {stage} failed: {exc.__class__.__name__}: {exc}; raw_preview={preview!r}", flush=True)


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
        api_key = effective_deepseek_key()
        if not api_key:
            raise RuntimeError("DeepSeek API Key 未配置，请在设置页填写官方 Key，或在 .env 中配置 DEEPSEEK_API_KEY。")

        self.model = resolve_model(model or settings.deepseek_default_model)
        self.client = OpenAI(
            api_key=api_key,
            base_url=effective_deepseek_base_url(),
        )

    def _stream_completion(self, messages: list[dict[str, str]], max_tokens: int | None = None) -> Iterable[str]:
        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "stream": True,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        stream = self.client.chat.completions.create(**kwargs)
        for chunk in stream:
            text = self.extract_stream_text(chunk)
            if text:
                yield text

    def _complete_text(self, messages: list[dict[str, str]], max_tokens: int = 64, json_object: bool = False) -> str:
        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if json_object:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            response = self.client.chat.completions.create(**kwargs)
        except Exception as exc:
            if not json_object:
                raise
            print(
                f"[llm-json] response_format=json_object unavailable, fallback to plain completion: {exc.__class__.__name__}: {exc}",
                flush=True,
            )
            kwargs.pop("response_format", None)
            response = self.client.chat.completions.create(**kwargs)
        choices = getattr(response, "choices", None) or []
        if not choices:
            return ""

        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", "") if message else ""
        return content or ""

    def _repair_agent_plan_json(self, raw: str, instruction: str, max_tokens: int = 4000) -> dict:
        messages = [
            {
                "role": "system",
                "content": (
                    "You repair malformed CodeLens Pro Agent plans. "
                    "Return one strict JSON object and nothing else. "
                    "Do not invent extra commentary. "
                    "Use this exact schema: "
                    '{"summary":"short summary","assumptions":["..."],"warnings":["..."],'
                    '"operations":[{"type":"create","path":"relative/path","new_path":null,'
                    '"content":"complete file text or null","reason":"why",'
                    '"edits":[{"search":"exact old text","replace":"new text"}]}]}. '
                    "Allowed operation types are create, update, delete, rename. "
                    "For update, use either content for a complete file replacement or edits for exact local replacements. "
                    "All paths must be workspace-relative."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User instruction:\n{instruction}\n\n"
                    "Malformed model output to repair:\n"
                    f"{_clip_text(raw, 6000)}"
                ),
            },
        ]
        repaired = self._complete_text(messages, max_tokens=max_tokens, json_object=True)
        return _parse_json_object(repaired)

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

    def generate_learning_card_candidates(
        self,
        code: str,
        report_content: str,
        report_title: str,
        report_mode: str,
        language_code: str,
        language_label: str,
        limit: int = 8,
    ) -> list[dict]:
        language_code, language_label, _ = resolve_language(language_code, language_label)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 CodeLens Pro 的编程学习卡片抽取助手。"
                    "请根据代码和报告内容，抽取真正值得复习的编程知识点候选。"
                    "不要做关键词堆砌，不要把普通报告标题当知识点。"
                    "只返回严格 JSON 数组，不要 Markdown，不要解释，不要推理过程。"
                    "每项必须包含 title、explanation、difficulty、tags、code_excerpt、detail_markdown、source_reason、confidence。"
                    "difficulty 只能是 入门、进阶、面试、项目 之一。"
                    "tags 是 2 到 6 个短标签。code_excerpt 必须来自用户代码或为空字符串。"
                    "detail_markdown 用中文 Markdown，包含 适用场景、常见误区、复习建议 三个小节。"
                    f"候选数量控制在 3 到 {max(3, min(limit, 8))} 个；如果材料很少，可以少于 3 个。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"语言：{language_label} ({language_code})\n"
                    f"报告类型：{report_mode}\n"
                    f"报告标题：{report_title}\n\n"
                    f"代码：\n```{language_code}\n{_clip_text(code, 18000)}\n```\n\n"
                    f"报告内容：\n{_clip_text(report_content, 16000)}"
                ),
            },
        ]
        raw = self._complete_text(messages, max_tokens=3600)
        value = _parse_json_array_or_object(raw)
        return [item for item in value if isinstance(item, dict)][: max(1, min(limit, 12))]

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
        selected_file_paths: list[str] | None = None,
    ) -> dict:
        if _looks_like_followup_apply_instruction(instruction) and previous_plans:
            for previous_plan in reversed(previous_plans):
                operations = previous_plan.get("operations") if isinstance(previous_plan, dict) else None
                if isinstance(operations, list) and operations:
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
                                "path": _normalize_agent_operation_path(path_value, selected_file_paths or []),
                                "new_path": _normalize_agent_operation_path(str(item.get("new_path") or ""), selected_file_paths or []) if item.get("new_path") else None,
                                "content": item.get("content"),
                                "reason": str(item.get("reason") or "").strip() or "沿用上一条 Agent 计划中的文件修改操作。",
                                "edits": _normalize_agent_operation_edits(item.get("edits")),
                            }
                        )
                    if normalized_operations:
                        return {
                            "summary": str(previous_plan.get("summary") or "沿用上一条可执行 Agent 计划。")[:500],
                            "assumptions": ["用户当前指令是在确认落实上一条 Agent 计划，因此沿用上一条计划的文件操作。"],
                            "warnings": [],
                            "operations": normalized_operations[:24],
                        }

        safe_fallback_operation = _safe_quick_start_readme_operation(
            instruction,
            files,
            code_context,
            history=history,
        )
        if safe_fallback_operation:
            safe_fallback_operation["path"] = _normalize_agent_operation_path(
                str(safe_fallback_operation.get("path") or ""),
                selected_file_paths or [],
            )
            return {
                "summary": "\u4e3a README \u8865\u5145\u5feb\u901f\u5f00\u59cb\u677f\u5757\u3002",
                "assumptions": ["\u7528\u6237\u8981\u6c42\u843d\u5b9e\u4e0a\u4e00\u6761\u5efa\u8bae\uff0c\u4e14\u8ba8\u8bba\u4e2d\u5df2\u660e\u786e\u63d0\u5230\u7f3a\u5c11\u5feb\u901f\u5f00\u59cb\u677f\u5757\u3002"],
                "warnings": [],
                "operations": [safe_fallback_operation],
            }

        file_sections: list[str] = []
        for index, item in enumerate(_ordered_agent_files(files), start=1):
            item_name = str(item.get("fileName") or item.get("file_name") or f"file-{index}")
            item_path = str(item.get("filePath") or item.get("file_path") or item_name)
            item_language = str(item.get("languageId") or item.get("language_id") or "text")
            item_attention = _file_attention(item)
            item_code = str(item.get("code") or "")
            file_sections.append(
                f"File {index}: {item_name}\nPath: {item_path}\nLanguage: {item_language}\nAttention: {item_attention}\n"
                f"```{item_language}\n{item_code}\n```"
            )

        context_parts = [
            f"Primary file: {file_name or 'unknown'}",
            f"Primary path: {file_path or 'unknown'}",
            f"Language: {language_label} ({language_code})",
            f"Current code:\n```{language_code}\n{code_context}\n```",
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
                    "Never return Markdown, prose, or an empty response. "
                    "The user may write instructions in Chinese or English; understand both. "
                    "If the instruction asks to add, update, rewrite, optimize, remove, rename, or create content, "
                    "you must produce concrete file operations whenever enough file context is provided. "
                    "All paths must be workspace-relative paths, never absolute paths. "
                    "Allowed operation types are create, update, delete, rename. "
                    "For create operations, content must contain the complete final file content. "
                    "For update operations on large existing files, prefer edits with exact search/replace snippets instead of returning the whole file. "
                    "Each edit.search must be copied exactly from the provided file context and each edit.replace must be the desired replacement text. "
                    "Use content for update only when replacing the entire file is truly intended. "
                    "For rename operations, include new_path. "
                    "Avoid deleting files unless the user explicitly asks for deletion. "
                    "Use this schema exactly: "
                    '{"summary":"short summary","assumptions":["..."],"warnings":["..."],'
                    '"operations":[{"type":"update","path":"src/file.py","new_path":null,'
                    '"content":null,"reason":"why","edits":[{"search":"exact old text","replace":"new text"}]}]}.'
                ),
            },
            {
                "role": "user",
                "content": f"User instruction:\n{instruction}\n\nWorkspace context:\n" + "\n\n".join(context_parts),
            },
        ]

        raw = self._complete_text(messages, max_tokens=8000, json_object=True)
        try:
            value = _parse_json_object(raw)
        except ValueError as first_error:
            _log_agent_plan_json_failure("initial_parse", raw, first_error)
            try:
                value = self._repair_agent_plan_json(raw, instruction)
            except Exception as repair_error:
                reproduce_operation = _openalex_reproduce_doc_operation(
                    instruction,
                    files,
                    code_context,
                    history=history,
                )
                if reproduce_operation:
                    reproduce_operation["path"] = _normalize_agent_operation_path(
                        str(reproduce_operation.get("path") or ""),
                        selected_file_paths or [],
                    )
                    return {
                        "summary": "创建 OpenAlex 实验复现说明文档。",
                        "assumptions": ["用户希望落实上一条关于可复现脚本或复现文档的建议。"],
                        "warnings": ["模型返回的计划 JSON 不完整，已使用本地规则生成 reproduce.md 的可确认计划。"],
                        "operations": [reproduce_operation],
                    }
                readme_operation = _project_readme_doc_operation(
                    instruction,
                    files,
                    code_context,
                    history=history,
                )
                if readme_operation:
                    readme_operation["path"] = _normalize_agent_operation_path(
                        str(readme_operation.get("path") or ""),
                        selected_file_paths or [],
                    )
                    return {
                        "summary": "创建或更新 README 项目说明文档。",
                        "assumptions": ["用户希望根据当前项目结构生成 README 项目说明。"],
                        "warnings": ["模型返回的计划 JSON 不完整，已使用本地规则生成 README.md 的可确认计划。"],
                        "operations": [readme_operation],
                    }
                fallback_operation = _quick_start_readme_operation(instruction, files, code_context)
                if fallback_operation:
                    fallback_operation["path"] = _normalize_agent_operation_path(str(fallback_operation.get("path") or ""), selected_file_paths or [])
                    return {
                        "summary": "为 README 补充快速开始板块。",
                        "assumptions": [],
                        "warnings": ["模型返回的计划 JSON 不完整，已使用本地规则生成一个可确认的 README 修改计划。"],
                        "operations": [fallback_operation],
                    }
                if isinstance(repair_error, ValueError):
                    raise first_error
                raise repair_error
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
                    "path": _normalize_agent_operation_path(path_value, selected_file_paths or []),
                    "new_path": _normalize_agent_operation_path(str(item.get("new_path") or ""), selected_file_paths or []) if item.get("new_path") else None,
                    "content": item.get("content"),
                    "reason": str(item.get("reason") or "").strip() or None,
                    "edits": _normalize_agent_operation_edits(item.get("edits")),
                }
            )

        if not normalized_operations and _looks_like_edit_instruction(instruction):
            retry_plan = self._retry_agent_plan_with_local_edits(
                instruction=instruction,
                context_parts=context_parts,
                selected_file_paths=selected_file_paths or [],
            )
            if retry_plan:
                value = retry_plan
                operations = value.get("operations") if isinstance(value.get("operations"), list) else []
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
                            "path": _normalize_agent_operation_path(path_value, selected_file_paths or []),
                            "new_path": _normalize_agent_operation_path(str(item.get("new_path") or ""), selected_file_paths or []) if item.get("new_path") else None,
                            "content": item.get("content"),
                            "reason": str(item.get("reason") or "").strip() or None,
                            "edits": _normalize_agent_operation_edits(item.get("edits")),
                        }
                    )

        if not normalized_operations and _looks_like_edit_instruction(instruction):
            fallback_operation = _openalex_reproduce_doc_operation(
                instruction,
                files,
                code_context,
                history=history,
            ) or _project_readme_doc_operation(
                instruction,
                files,
                code_context,
                history=history,
            ) or _quick_start_readme_operation(instruction, files, code_context)
            if fallback_operation:
                fallback_operation["path"] = _normalize_agent_operation_path(str(fallback_operation.get("path") or ""), selected_file_paths or [])
                normalized_operations.append(fallback_operation)
                fallback_path = str(fallback_operation.get("path") or "")
                value["summary"] = (
                    "创建 OpenAlex 实验复现说明文档。"
                    if fallback_path == "reproduce.md"
                    else "创建或更新 README 项目说明文档。"
                    if fallback_path.lower().rsplit("/", 1)[-1] in {"readme.md", "readme.markdown"}
                    else "为 README 补充快速开始板块。"
                )
                warnings = value.get("warnings")
                if not isinstance(warnings, list):
                    value["warnings"] = []
                if fallback_path == "reproduce.md":
                    value["warnings"].append("模型未生成具体文件操作，已使用本地规则生成 reproduce.md 的可确认计划。")
                elif fallback_path.lower().rsplit("/", 1)[-1] in {"readme.md", "readme.markdown"}:
                    value["warnings"].append("模型未生成具体文件操作，已使用本地规则生成 README.md 的可确认计划。")

        return {
            "summary": str(value.get("summary") or instruction).strip()[:500],
            "assumptions": [str(item) for item in value.get("assumptions", []) if str(item).strip()][:12],
            "warnings": [str(item) for item in value.get("warnings", []) if str(item).strip()][:12],
            "operations": normalized_operations[:24],
        }

    def _retry_agent_plan_with_local_edits(
        self,
        *,
        instruction: str,
        context_parts: list[str],
        selected_file_paths: list[str],
    ) -> dict | None:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are retrying a CodeLens Pro Agent file modification plan because the first plan had no operations. "
                    "Return one strict JSON object and nothing else. "
                    "The user asked for a concrete change, so produce at least one operation if there is any relevant file context. "
                    "For large files, use update operations with edits, not whole-file content. "
                    "Each edit.search must be an exact snippet from the provided file and edit.replace must be the replacement. "
                    "Schema: "
                    '{"summary":"short summary","assumptions":["..."],"warnings":["..."],'
                    '"operations":[{"type":"update","path":"relative/path","new_path":null,'
                    '"content":null,"reason":"why","edits":[{"search":"exact old text","replace":"new text"}]}]}.'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User instruction:\n{instruction}\n\n"
                    f"Selected paths:\n{json.dumps(selected_file_paths, ensure_ascii=False)}\n\n"
                    "Workspace context:\n"
                    + "\n\n".join(context_parts)
                ),
            },
        ]
        try:
            raw = self._complete_text(messages, max_tokens=8000, json_object=True)
            value = _parse_json_object(raw)
        except Exception as exc:
            print(f"[agent-plan-retry] failed to produce local edit plan: {exc.__class__.__name__}: {exc}", flush=True)
            return None
        return value if isinstance(value, dict) else None

    def summarize_agent_file_for_plan(self, instruction: str, file_item: dict, index: int, total: int) -> str:
        item_name = str(file_item.get("fileName") or file_item.get("file_name") or f"file-{index}")
        item_path = str(file_item.get("filePath") or file_item.get("file_path") or item_name)
        item_language = str(file_item.get("languageId") or file_item.get("language_id") or "text")
        item_code = str(file_item.get("code") or "")
        messages = [
            {
                "role": "system",
                "content": (
                    "You summarize one file for a CodeLens Pro Agent planning pass. "
                    "Do not propose final operations yet. "
                    "Return concise Chinese bullet points only, focused on facts needed to modify this file for the user request. "
                    "Mention exact symbols, imports, functions, print/logging calls, and likely edit locations when relevant. "
                    "When a local replacement is likely needed, include the exact old snippet that should be used as edit.search. "
                    "Do not output chain-of-thought."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User instruction:\n{instruction}\n\n"
                    f"File {index}/{total}: {item_name}\nPath: {item_path}\nLanguage: {item_language}\n\n"
                    f"```{item_language}\n{item_code}\n```"
                ),
            },
        ]
        return self._complete_text(messages, max_tokens=1800).strip()

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

    def _daily_work_log_messages(self, log_date: str, context_markdown: str, stats: dict) -> list[dict[str, str]]:
        return [
            {
                "role": "system",
                "content": (
                    "你是 CodeLens Pro 的每日工作日志整理助手。"
                    "请根据当天使用记录生成一张中文 Markdown 日志卡片。"
                    "风格像开发者日记：克制、具体、可回看，不要夸张，不要编造没有发生的事。"
                    "必须包含这些小节：今日概览、完成事项、AI 对话与报告、Agent 实践、知识卡片与学习、明日建议。"
                    "第一行必须是一级标题：# 📋 CodeLens Pro 日志卡片 — 日期。"
                    "只输出 Markdown 正文，不要用 ```markdown 或其他代码围栏包裹整篇日志。"
                    "如果某类记录为空，请简短说明当天没有对应活动。不要输出推理过程。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"日期：{log_date}\n"
                    f"统计：{json.dumps(stats, ensure_ascii=False)}\n\n"
                    f"请以这一行开头：# 📋 CodeLens Pro 日志卡片 — {log_date}\n\n"
                    f"当天记录：\n{_clip_text(context_markdown, 26000)}"
                ),
            },
        ]

    def generate_daily_work_log(self, log_date: str, context_markdown: str, stats: dict) -> str:
        messages = self._daily_work_log_messages(log_date, context_markdown, stats)
        return self._complete_text(messages, max_tokens=2200)

    def stream_daily_work_log(self, log_date: str, context_markdown: str, stats: dict) -> Iterable[str]:
        return self._stream_completion(self._daily_work_log_messages(log_date, context_markdown, stats), max_tokens=2200)

    def _learning_card_material_messages(
        self,
        title: str,
        language_label: str,
        difficulty: str,
        explanation: str,
        tags: list[str],
        code_excerpt: str | None,
        source_links: list[dict],
    ) -> list[dict[str, str]]:
        return [
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
        messages = self._learning_card_material_messages(
            title,
            language_label,
            difficulty,
            explanation,
            tags,
            code_excerpt,
            source_links,
        )
        return self._complete_text(messages, max_tokens=1800)

    def stream_learning_card_material(
        self,
        title: str,
        language_label: str,
        difficulty: str,
        explanation: str,
        tags: list[str],
        code_excerpt: str | None,
        source_links: list[dict],
    ) -> Iterable[str]:
        return self._stream_completion(
            self._learning_card_material_messages(
                title,
                language_label,
                difficulty,
                explanation,
                tags,
                code_excerpt,
                source_links,
            ),
            max_tokens=1800,
        )

    def suggest_learning_card_tags(self, cards: list[dict]) -> list[dict]:
        compact_cards = [
            {
                "id": str(item.get("id") or ""),
                "title": str(item.get("title") or "")[:120],
                "language_label": str(item.get("language_label") or "通用")[:32],
                "difficulty": str(item.get("difficulty") or "")[:24],
                "status": str(item.get("status") or "")[:24],
                "tags": [str(tag)[:32] for tag in item.get("tags", []) if str(tag).strip()][:8],
                "explanation": _clip_text(str(item.get("explanation") or ""), 420),
            }
            for item in cards
            if str(item.get("id") or "").strip()
        ]
        messages = [
            {
                "role": "system",
                "content": (
                    "你是编程学习卡片的标签整理助手。请只输出 JSON 数组，不要 Markdown。"
                    "每个建议对象必须包含 id、action、title、reason、card_ids、from_tags、to_tags。"
                    "action 只能是 merge、add、remove、rename。"
                    "建议应保守、可解释，优先合并同义标签、删除过泛标签、补充少量主题标签。"
                    "不要修改卡片正文，不要发明与卡片无关的主题。最多输出 12 条建议。"
                ),
            },
            {
                "role": "user",
                "content": f"知识卡片列表：\n{_clip_text(json.dumps(compact_cards, ensure_ascii=False), 28000)}",
            },
        ]
        raw = self._complete_text(messages, max_tokens=2200)
        value = _parse_json_array_or_object(raw)
        return [item for item in value if isinstance(item, dict)]

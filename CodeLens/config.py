# config.py —— 配置与 Prompt 控制中心
import os

# ============================================================
#  大模型 API 配置
# ============================================================
# 推荐在系统环境变量中配置：
# Windows PowerShell:
#   $env:DEEPSEEK_API_KEY="你的 key"
#   $env:DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip().rstrip("/")

# ============================================================
#  模型配置
# ============================================================
DEFAULT_MODEL = os.getenv("DEEPSEEK_DEFAULT_MODEL", "deepseek-v4-flash")
DEFAULT_MODEL_LABEL = os.getenv("DEEPSEEK_DEFAULT_MODEL_LABEL", "DeepSeek-V4-Flash")

MODEL_OPTIONS = {
    "DeepSeek-V4-Flash": "deepseek-v4-flash",
    "DeepSeek-V4-Pro": "deepseek-v4-pro",
}

# 预留：后续如果接入多个供应商，可以在这里扩展。
PROVIDER_OPTIONS = {
    "DeepSeek": {
        "base_url": BASE_URL,
        "api_key_env": "DEEPSEEK_API_KEY",
        "models": MODEL_OPTIONS,
        "default_model": DEFAULT_MODEL,
    }
}

# ============================================================
#  代码语言配置
# ============================================================
LANGUAGE_OPTIONS = {
    "Python": "python",
    "Java": "java",
    "JavaScript": "javascript",
    "C++": "cpp",
    "C": "c",
}

DEFAULT_LANGUAGE_LABEL = os.getenv("CODELENS_DEFAULT_LANGUAGE", "Python")

COMMENT_STYLE_BY_LANGUAGE = {
    "python": "#",
    "java": "//",
    "javascript": "//",
    "cpp": "//",
    "c": "//",
}

# ============================================================
#  页面样式
# ============================================================
# 新版 app.py 已内置主要样式。这里保留 CSS_STYLE，兼容旧版 app.py。
CSS_STYLE = """
<style>
.stApp {
    background: #0f172a;
    color: #e2e8f0;
}
.stButton > button {
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 8px;
}
.stButton > button:hover {
    border-color: #38bdf8;
    color: #38bdf8;
}
.stTextArea textarea {
    background: #1e293b !important;
    color: #f8fafc !important;
    border: 1px solid #334155 !important;
    border-radius: 8px !important;
    font-family: "JetBrains Mono", "Fira Code", Consolas, Monaco, monospace !important;
    font-size: 13.5px !important;
    line-height: 1.65 !important;
}
div[data-testid="stMetric"] {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
}
div[data-testid="stMetricValue"] {
    color: #38bdf8 !important;
    font-weight: 700 !important;
}
</style>
"""

# ============================================================
#  通用 Prompt 片段
# ============================================================
COMMON_REPORT_RULES = """
通用要求：
1. 当前语言：{language_label}。
2. 代码块使用 `{language_code}` 标记。
3. 注释请使用该语言常用注释符号；当前建议使用 `{comment_marker}`。
4. 回答必须基于用户给出的代码，不要脱离代码泛泛而谈。
5. 先给出必要的代码摘录或注释版代码，再进行分析。
6. 代码摘录必须保持原有缩进，不能改变代码结构。
7. 如果代码很长，不需要全文复制，只摘出导入/包含、类、函数/方法、主流程、关键分支、关键循环、数据库/文件/API 操作等位置。
8. 如果发现外部变量、外部函数或上下文缺失，可以说明“此处依赖外部定义”，不要强行猜测。
9. 不要输出模型推理过程，不要写“我将如何分析”，直接给结果。
"""

CODE_EXCERPT_RULES = """
代码摘录规则：
- 短函数/方法：可以输出完整注释版代码。
- 长函数或完整文件：优先输出结构化摘录。
- 注释可以放在行尾，也可以单独成行。
- 不要为了注释而破坏代码缩进。
"""

# ============================================================
#  函数/方法级分析 Prompt
# ============================================================
FUNCTION_PROMPTS = {
    "func_comment": (
        "你是一名代码讲解助手。请对下面的 {language_label} 函数或方法做注释解析。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        "输出格式：\n"
        "### 1. 注释版代码\n"
        "```{language_code}\n"
        "{comment_marker} 在代码中添加必要中文注释\n"
        "```\n\n"
        "要求：\n"
        "1. 尽量保留原代码的每一行，不随意增删代码。\n"
        "2. 对关键行添加简洁中文注释，说明这一行做什么。\n\n"
        "### 2. 执行流程\n"
        "用 3-6 条说明代码从输入到输出的大致流程。\n\n"
        "代码如下：\n"
    ),
    "func_design": (
        "你是一名代码分析助手。请说明下面 {language_label} 函数或方法的核心逻辑和设计思路。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 关键代码与注释\n"
        "### 2. 代码作用\n"
        "### 3. 核心逻辑\n"
        "### 4. 需要注意的地方\n\n"
        "代码如下：\n"
    ),
    "func_optimize": (
        "你是一名代码审查助手。请对下面 {language_label} 函数或方法提出可执行的优化建议。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 关键代码摘录\n"
        "### 2. 问题说明\n"
        "### 3. 修改建议\n"
        "### 4. 修改影响\n\n"
        "代码如下：\n"
    ),
    "func_knowledge": (
        "你是一名编程学习辅导助手。请从下面 {language_label} 代码中提炼可学习的语法和写法。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 相关代码摘录\n"
        "### 2. 知识点说明\n"
        "### 3. 学习建议\n\n"
        "代码如下：\n"
    ),
    "func_trace": (
        "你是一名编程运行过程讲解助手。请对下面 {language_label} 函数或方法做代码运行推演，帮助初学者理解程序如何一步步执行。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        "第一部分必须先输出一个 fenced code block，语言标记必须是 ```{language_code}。"
        "在代码块中尽量保留原代码结构，用中文注释标出执行顺序、关键变量变化、数据流动、循环/递归进入与退出、返回值如何产生。"
        "如果原代码较长，可以截取最关键路径，但必须让注释能串起完整运行过程。\n\n"
        "输出格式：\n"
        "### 1. 运行注释版代码\n"
        "```{language_code}\n"
        "{comment_marker} 在这里输出带执行流/数据流注释的代码\n"
        "```\n\n"
        "### 2. 执行路径\n"
        "按真实运行顺序分步骤说明，从入口、分支、循环或递归一直到返回结果。\n\n"
        "### 3. 关键变量时间线\n"
        "用表格或列表展示关键变量在不同阶段的值或状态变化。\n\n"
        "### 4. 易误解点\n"
        "指出初学者容易看错的执行顺序、边界条件、作用域或数据流。\n\n"
        "### 5. 可手动调试的方法\n"
        "给出 2-4 条可以用断点、print/log 或小输入样例验证运行过程的方法。\n\n"
        "代码如下：\n"
    ),
}

# 兼容旧版 mode 名称
FUNCTION_PROMPTS.update({
    "func_line_by_line": FUNCTION_PROMPTS["func_comment"],
    "func_deep_explain": FUNCTION_PROMPTS["func_design"],
})

# ============================================================
#  文件/脚本级分析 Prompt
# ============================================================
SCRIPT_PROMPTS = {
    "script_structure": (
        "你是一名代码结构分析助手。请分析下面完整 {language_label} 代码的整体结构。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 结构化代码摘录\n"
        "### 2. 执行流程\n"
        "### 3. 模块职责\n"
        "### 4. 结构改进建议\n\n"
        "代码如下：\n"
    ),
    "script_api": (
        "你是一名代码文档整理助手。请整理下面 {language_label} 代码中的函数、方法、类或接口。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 定义摘录\n"
        "### 2. 参数与返回值\n"
        "### 3. 调用关系\n"
        "### 4. 文档补充建议\n\n"
        "代码如下：\n"
    ),
    "script_complexity": (
        "你是一名复杂度分析助手。请分析下面 {language_label} 代码的时间复杂度和空间复杂度。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 复杂度相关代码摘录\n"
        "### 2. 时间复杂度\n"
        "### 3. 空间复杂度\n"
        "### 4. 可能的性能瓶颈\n\n"
        "代码如下：\n"
    ),
    "script_security": (
        "你是一名安全和稳定性检查助手。请检查下面 {language_label} 代码的安全风险和健壮性问题。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        f"{CODE_EXCERPT_RULES}\n"
        "输出格式：\n"
        "### 1. 风险相关代码摘录\n"
        "### 2. 安全风险\n"
        "### 3. 稳定性问题\n"
        "### 4. 修改建议\n\n"
        "代码如下：\n"
    ),
}

# 兼容旧版 mode 名称
SCRIPT_PROMPTS["script_per_function"] = SCRIPT_PROMPTS["script_api"]

# ============================================================
#  双版本对比 Prompt
# ============================================================
DIFF_PROMPTS = {
    "diff_overview": (
        "你是一名代码对比助手。用户会提供两个版本的 {language_label} 代码，请做整体对比。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        "输出格式：\n"
        "### 1. 关键差异代码摘录\n"
        "### 2. 功能差异\n"
        "### 3. 对比结论\n"
        "### 4. 建议使用哪个版本\n\n"
    ),
    "diff_approach": (
        "你是一名实现思路分析助手。用户会提供两个版本的 {language_label} 代码，请比较两者的实现方式。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        "输出格式：\n"
        "### 1. 两个版本的关键代码摘录\n"
        "### 2. 实现思路对比\n"
        "### 3. 主要取舍\n"
        "### 4. 可以如何合并优点\n\n"
    ),
    "diff_performance": (
        "你是一名性能对比助手。用户会提供两个版本的 {language_label} 代码，请比较它们的运行效率。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        "输出格式：\n"
        "### 1. 性能相关代码摘录\n"
        "### 2. 时间复杂度对比\n"
        "### 3. 空间复杂度对比\n"
        "### 4. 性能改进建议\n\n"
    ),
    "diff_quality": (
        "你是一名代码质量检查助手。用户会提供两个版本的 {language_label} 代码，请比较质量和健壮性。\n\n"
        f"{COMMON_REPORT_RULES}\n"
        "输出格式：\n"
        "### 1. 质量相关代码摘录\n"
        "### 2. 可读性对比\n"
        "### 3. 健壮性对比\n"
        "### 4. 修改建议\n\n"
    ),
}

PROMPT_TEMPLATES = {
    **FUNCTION_PROMPTS,
    **SCRIPT_PROMPTS,
    **DIFF_PROMPTS,
}

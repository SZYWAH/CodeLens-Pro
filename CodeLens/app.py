# app.py —— CodeLens 三栏独立版
# 改动重点：
# 1. 页面三栏布局：观测台 4/15、报告 8/15、AI 对话 3/15。
# 2. 中间报告区与右侧 AI 对话区完全独立。
# 3. 生成报告后会保存到 st.session_state，之后进行 AI 对话不会清空或刷新报告。
# 4. 右侧 AI 对话不再依附左侧代码上下文，只接收用户输入的普通 prompt。
# 5. 报告区、AI 对话历史区均固定高度，内容过长时内部滚动。
# 6. 流式输出只展示 delta.content，彻底过滤 reasoning_content / ChatCompletionChunk 对象。
# 7. 报告区支持全屏报告视图，并提供返回对应功能页按钮。
# 8. 使用可控页面导航替代 st.tabs，确保全屏返回后回到原功能页且保留用户输入。
# 9. 修复 active_page 绑定 radio 后再次赋值导致的 StreamlitAPIException。
# 10. 将用户代码输入同步到持久状态，避免全屏报告页隐藏控件后输入内容被 Streamlit 清理。
# 11. 压缩顶部标题、语言选择、模型选择和导航区高度，减少首屏空间占用。
# 12. 新增历史报告页，报告自动保存到 app.py 同目录下的 report_history 文件夹。
# 13. 首页增加应用目标与使用场景说明，历史报告页增加统计卡片和更清晰的详情布局。

import re
import json
import uuid
from datetime import datetime
from pathlib import Path

import streamlit as st
import config  # 保留原项目配置导入，避免其他模块依赖 config 时出错
from core.llm_client import CodeLensAI
from core.analyzer import static_scan


# ── 页面基本配置 ──
st.set_page_config(layout="wide", page_title="CodeLens | 代码智能透视系统")

# 历史报告保存目录：与 app.py 位于同一项目目录下。
APP_DIR = Path(__file__).resolve().parent
REPORT_HISTORY_DIR = APP_DIR / "report_history"
REPORT_HISTORY_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
#  全局样式
# ============================================================
# 固定为 Claude / 现代产品风格的字体栈：
# 优先使用 Inter、SF Pro、Segoe UI 等高级 UI 字体；
# 中文环境下回退到 Noto Sans SC / Microsoft YaHei。
APP_FONT_STACK = (
    "'Inter', 'SF Pro Text', 'SF Pro Display', -apple-system, BlinkMacSystemFont, "
    "'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, "
    "'Noto Sans SC', 'Microsoft YaHei', sans-serif"
)

CODE_FONT_STACK = (
    "'JetBrains Mono', 'Fira Code', Consolas, Monaco, "
    "'Noto Sans Mono CJK SC', 'Microsoft YaHei Mono', monospace"
)

st.markdown(
    f"""
<style>
    html, body, [data-testid="stAppViewContainer"], [data-testid="stHeader"] {{
        font-family: {APP_FONT_STACK} !important;
        background-color: #0F172A !important;
        color: #E2E8F0 !important;
    }}

    /* 压缩页面顶部空白 */
    [data-testid="stAppViewContainer"] > .main .block-container {{
        padding-top: 0.35rem !important;
        padding-bottom: 0.8rem !important;
    }}

    /* 紧凑顶部标题 */
    .compact-top-title {{
        font-size: 1.45rem;
        line-height: 1.05;
        font-weight: 750;
        color: #FFFFFF;
        margin: 0 0 0.05rem 0;
        letter-spacing: -0.02em;
    }}

    .compact-top-subtitle {{
        font-size: 0.78rem;
        line-height: 1.05;
        color: #94A3B8;
        margin: 0;
    }}

    /* 压缩顶部 selectbox 和导航 */
    div[data-testid="stSelectbox"] {{
        margin-bottom: -0.45rem !important;
    }}

    div[data-testid="stSelectbox"] label {{
        min-height: 0 !important;
        padding-bottom: 0 !important;
    }}

    div[role="radiogroup"] {{
        gap: 0.28rem !important;
        margin-top: -0.35rem !important;
        margin-bottom: -0.35rem !important;
    }}

    div[role="radiogroup"] label {{
        padding: 0.18rem 0.65rem !important;
        min-height: 30px !important;
    }}

    div[role="radiogroup"] label p {{
        font-size: 0.88rem !important;
        line-height: 1.1 !important;
    }}

    h1, h2, h3 {{
        color: #FFFFFF !important;
        font-weight: 700 !important;
    }}

    .stMarkdown p, .stMarkdown li {{
        color: #CBD5E1 !important;
    }}

    .stButton>button {{
        border: 1px solid #334155 !important;
        background-color: #1E293B !important;
        color: #E2E8F0 !important;
        border-radius: 6px !important;
        font-weight: 500 !important;
        transition: all 0.2s ease;
    }}
    .stButton>button:hover {{
        border-color: #38BDF8 !important;
        color: #38BDF8 !important;
        background-color: #1E293B !important;
    }}

    textarea {{
        background-color: #1E293B !important;
        color: #F8FAFC !important;
        border: 1px solid #334155 !important;
        border-radius: 8px !important;
        font-family: {CODE_FONT_STACK} !important;
        font-size: 0.92rem !important;
        line-height: 1.62 !important;
    }}

    div[data-testid="stVerticalBlockBorderWrapper"] {{
        background-color: #1E293B !important;
        border-color: #334155 !important;
        border-radius: 8px !important;
    }}

    .feature-card-clean {{
        padding: 20px;
        background-color: #1E293B;
        border: 1px solid #334155;
        border-radius: 8px;
        margin-bottom: 12px;
    }}
    .feature-card-clean h3 {{
        color: #38BDF8 !important;
        margin-top: 0;
    }}
    .feature-card-clean p {{
        color: #94A3B8 !important;
    }}

    .stTabs [data-baseweb="tab"] {{
        color: #94A3B8 !important;
    }}
    .stTabs [data-baseweb="tab"][aria-selected="true"] {{
        color: #38BDF8 !important;
        border-bottom-color: #38BDF8 !important;
    }}

    [data-testid="stMetricValue"] {{
        font-size: 1.6rem !important;
        font-weight: 700 !important;
        color: #38BDF8 !important;
    }}

    .fullscreen-report-title {{
        color: #E2E8F0;
        font-size: 1.05rem;
        margin: 0.25rem 0 0.8rem 0;
    }}

    .fullscreen-report-shell {{
        padding: 4px 2px;
    }}

    .home-hero-card {{
        padding: 18px 20px;
        background: linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.96));
        border: 1px solid #334155;
        border-radius: 12px;
        margin: 8px 0 14px 0;
    }}

    .home-hero-title {{
        font-size: 1.1rem;
        font-weight: 700;
        color: #F8FAFC;
        margin-bottom: 0.35rem;
    }}

    .home-hero-text {{
        font-size: 0.92rem;
        line-height: 1.7;
        color: #CBD5E1;
        margin: 0;
    }}

    .home-mini-card {{
        padding: 14px 16px;
        background-color: #111827;
        border: 1px solid #334155;
        border-radius: 10px;
        min-height: 132px;
    }}

    .home-mini-card h4 {{
        color: #38BDF8 !important;
        margin: 0 0 8px 0 !important;
        font-size: 0.98rem !important;
    }}

    .home-mini-card p {{
        color: #CBD5E1 !important;
        font-size: 0.88rem !important;
        line-height: 1.55 !important;
        margin: 0 !important;
    }}

    .history-summary-card {{
        padding: 12px 14px;
        background-color: #111827;
        border: 1px solid #334155;
        border-radius: 10px;
        margin-bottom: 10px;
    }}

    .history-summary-card .label {{
        color: #94A3B8;
        font-size: 0.78rem;
        margin-bottom: 4px;
    }}

    .history-summary-card .value {{
        color: #F8FAFC;
        font-size: 1.25rem;
        font-weight: 750;
        line-height: 1.2;
    }}

    .history-detail-header {{
        padding: 14px 16px;
        background-color: #111827;
        border: 1px solid #334155;
        border-radius: 10px;
        margin: 8px 0 10px 0;
    }}

    .history-detail-title {{
        color: #F8FAFC;
        font-size: 1.02rem;
        font-weight: 700;
        margin-bottom: 6px;
    }}

    .history-detail-meta {{
        color: #94A3B8;
        font-size: 0.82rem;
        line-height: 1.6;
    }}
</style>
""",
    unsafe_allow_html=True,
)


# ============================================================
#  模型与语言配置
# ============================================================
DEEPSEEK_MODEL_OPTIONS = getattr(config, "MODEL_OPTIONS", {
    "DeepSeek-V4-Flash": "deepseek-v4-flash",
    "DeepSeek-V4-Pro": "deepseek-v4-pro",
})

DEFAULT_MODEL_LABEL = getattr(config, "DEFAULT_MODEL_LABEL", "DeepSeek-V4-Flash")
if DEFAULT_MODEL_LABEL not in DEEPSEEK_MODEL_OPTIONS:
    DEFAULT_MODEL_LABEL = "DeepSeek-V4-Flash" if "DeepSeek-V4-Flash" in DEEPSEEK_MODEL_OPTIONS else next(iter(DEEPSEEK_MODEL_OPTIONS))

LANGUAGE_OPTIONS = getattr(config, "LANGUAGE_OPTIONS", {
    "Python": "python",
    "Java": "java",
    "JavaScript": "javascript",
    "C++": "cpp",
    "C": "c",
})

DEFAULT_LANGUAGE_LABEL = getattr(config, "DEFAULT_LANGUAGE_LABEL", "Python")
if DEFAULT_LANGUAGE_LABEL not in LANGUAGE_OPTIONS:
    DEFAULT_LANGUAGE_LABEL = "Python" if "Python" in LANGUAGE_OPTIONS else next(iter(LANGUAGE_OPTIONS))

COMMENT_STYLE_BY_LANGUAGE = getattr(config, "COMMENT_STYLE_BY_LANGUAGE", {
    "python": "#",
    "java": "//",
    "javascript": "//",
    "cpp": "//",
    "c": "//",
})


def get_selected_model_id() -> str:
    label = st.session_state.get("selected_ai_model_label", DEFAULT_MODEL_LABEL)
    return DEEPSEEK_MODEL_OPTIONS.get(label, DEEPSEEK_MODEL_OPTIONS[DEFAULT_MODEL_LABEL])


def get_selected_language_label() -> str:
    label = st.session_state.get("selected_language_label", DEFAULT_LANGUAGE_LABEL)
    return label if label in LANGUAGE_OPTIONS else DEFAULT_LANGUAGE_LABEL


def get_selected_language_code() -> str:
    return LANGUAGE_OPTIONS.get(get_selected_language_label(), LANGUAGE_OPTIONS[DEFAULT_LANGUAGE_LABEL])


def get_selected_comment_marker() -> str:
    return COMMENT_STYLE_BY_LANGUAGE.get(get_selected_language_code(), "//")


def apply_model_to_engine(engine, model_id: str):
    """
    尽量兼容不同写法的 CodeLensAI。
    如果 core.llm_client.CodeLensAI 支持 set_model，会优先调用 set_model。
    """
    try:
        if hasattr(engine, "set_model"):
            engine.set_model(model_id)
    except Exception:
        pass

    for attr in [
        "model",
        "model_name",
        "model_id",
        "deepseek_model",
        "chat_model",
        "default_model",
    ]:
        try:
            setattr(engine, attr, model_id)
        except Exception:
            pass

    for attr in [
        "MODEL",
        "MODEL_NAME",
        "DEEPSEEK_MODEL",
        "DEEPSEEK_MODEL_NAME",
        "OPENAI_MODEL",
        "CHAT_MODEL",
    ]:
        try:
            if hasattr(config, attr):
                setattr(config, attr, model_id)
        except Exception:
            pass

    return engine


def build_ai_engine(model_id: str):
    try:
        engine = CodeLensAI(model=model_id)
    except TypeError:
        try:
            engine = CodeLensAI(model_name=model_id)
        except TypeError:
            engine = CodeLensAI()

    return apply_model_to_engine(engine, model_id)


# ============================================================
#  会话状态初始化
# ============================================================
if "selected_ai_model_label" not in st.session_state:
    st.session_state.selected_ai_model_label = DEFAULT_MODEL_LABEL

if "selected_language_label" not in st.session_state:
    st.session_state.selected_language_label = DEFAULT_LANGUAGE_LABEL

if "applied_ai_model_id" not in st.session_state:
    st.session_state.applied_ai_model_id = ""

if "ai_engine" not in st.session_state:
    current_model_id = get_selected_model_id()
    st.session_state.ai_engine = build_ai_engine(current_model_id)
    st.session_state.applied_ai_model_id = current_model_id

# 报告状态：中间报告区专用
for key in [
    "func_report_title",
    "func_report_content",
    "script_report_title",
    "script_report_content",
    "diff_report_title",
    "diff_report_content",
]:
    if key not in st.session_state:
        st.session_state[key] = ""

# 用户代码输入持久状态：
# 不直接依赖 text_area 的 widget key，避免进入全屏报告页时控件未渲染导致输入内容被 Streamlit 清理。
for key in [
    "func_code_saved",
    "scr_code_saved",
    "diff_code_a_saved",
    "diff_code_b_saved",
]:
    if key not in st.session_state:
        st.session_state[key] = ""


# AI 对话状态：右侧独立对话区专用
for key in ["independent_ai_chat"]:
    if key not in st.session_state:
        st.session_state[key] = []

# 各功能页的待生成报告任务
for key in [
    "func_pending_mode",
    "script_pending_mode",
    "diff_pending_mode",
]:
    if key not in st.session_state:
        st.session_state[key] = ""


# 页面导航状态：替代 st.tabs，保证全屏返回后能回到原功能页
PAGE_HOME = "🏠  首页"
PAGE_FUNC = "🔬  函数分析"
PAGE_SCRIPT = "📜  脚本分析"
PAGE_DIFF = "🆚  代码对比"
PAGE_HISTORY = "🗂️  历史报告"

PAGE_OPTIONS = [PAGE_HOME, PAGE_FUNC, PAGE_SCRIPT, PAGE_DIFF, PAGE_HISTORY]

REPORT_PAGE_MAP = {
    "func": PAGE_FUNC,
    "script": PAGE_SCRIPT,
    "diff": PAGE_DIFF,
}

if "active_page" not in st.session_state:
    st.session_state.active_page = PAGE_HOME


# ============================================================
#  通用组件
# ============================================================
def find_secret_risks(code: str) -> list[dict[str, str]]:
    """简单敏感信息扫描：跨语言通用。"""
    patterns = [
        ("API Key", r"(?i)(api[_-]?key|apikey|access[_-]?key|secret[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
        ("Token", r"(?i)(token|bearer)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
        ("Password", r"(?i)(password|passwd|pwd)\s*[:=]\s*['\"][^'\"]{4,}['\"]"),
        ("Private Key", r"-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----"),
        ("JDBC/MySQL URL", r"(?i)(jdbc:mysql://|mysql://|postgresql://|mongodb://)"),
    ]

    risks: list[dict[str, str]] = []
    for risk_type, pattern in patterns:
        for match in re.finditer(pattern, code):
            risks.append({
                "type": risk_type,
                "match": match.group(0),
            })
    return risks


def generic_static_scan(code: str, language_code: str) -> dict:
    """
    多语言轻量静态指标。
    说明：这里只做展示层面的快速统计，不替代专业 AST/编译器分析。
    """
    lines = [
        line for line in code.splitlines()
        if line.strip()
    ]

    names: list[str] = []
    lang = (language_code or "").lower()

    if lang == "python":
        names = re.findall(r"^\s*def\s+([A-Za-z_]\w*)\s*\(", code, flags=re.M)

    elif lang == "javascript":
        patterns = [
            r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(",
            r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>",
            r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>",
            r"^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{",
        ]
        for pattern in patterns:
            names.extend(re.findall(pattern, code, flags=re.M))

    elif lang == "java":
        pattern = (
            r"^\s*(?:public|private|protected)?\s*"
            r"(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?"
            r"(?:<[^>]+>\s*)?"
            r"(?:[A-Za-z_][\w<>\[\], ?]*\s+)?"
            r"([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:throws\s+[^{]+)?\{"
        )
        names = re.findall(pattern, code, flags=re.M)
        names = [n for n in names if n not in {"if", "for", "while", "switch", "catch"}]

    elif lang in {"c", "cpp"}:
        pattern = (
            r"^\s*(?:template\s*<[^>]+>\s*)?"
            r"(?:[A-Za-z_][\w:<>\*\&\s]+)\s+"
            r"([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?\{"
        )
        names = re.findall(pattern, code, flags=re.M)
        names = [n for n in names if n not in {"if", "for", "while", "switch", "catch"}]

    seen = set()
    unique_names = []
    for name in names:
        if name not in seen:
            seen.add(name)
            unique_names.append(name)

    return {
        "lines": len(lines),
        "functions": {
            "count": len(unique_names),
            "names": unique_names,
        },
        "secrets_risk": find_secret_risks(code),
    }


def scan_code(code: str, language_code: str) -> dict:
    """按语言选择静态扫描方式。"""
    if language_code == "python":
        try:
            return static_scan(code)
        except Exception:
            return generic_static_scan(code, language_code)

    return generic_static_scan(code, language_code)


def metrics_bar(code: str, language_code: str, show_secrets_detail: bool = False):
    """左侧观测台：静态指标栏。"""
    m = scan_code(code, language_code)
    c1, c2, c3 = st.columns(3)
    c1.metric("代码有效行数", m["lines"])
    c2.metric("函数/方法数量", m["functions"]["count"])
    c3.metric("敏感信息隐患", len(m["secrets_risk"]))

    if m["functions"]["names"]:
        shown_names = ", ".join(m["functions"]["names"][:12])
        if len(m["functions"]["names"]) > 12:
            shown_names += ", ..."
        st.caption(f"📦 检测到函数/方法: `{shown_names}`")

    if show_secrets_detail and m["secrets_risk"]:
        for item in m["secrets_risk"]:
            st.warning(f"🚨 {item['type']}: `{item['match'][:60]}…`")


def queue_report(panel_key: str, mode: str, required_widget_keys=None):
    """按钮回调：记录本次要生成的报告。"""
    st.session_state[f"{panel_key}_pending_mode"] = mode


def report_button_grid(buttons: list[tuple[str, str, str, str]], panel_key: str, required_widget_keys: list[str]):
    """2x2 报告按钮组。按钮第一次点击就会触发生成任务。"""
    r1, r2 = st.columns(2), st.columns(2)
    for idx, (label, tip, mode, key) in enumerate(buttons):
        target_row = r1 if idx < 2 else r2
        with target_row[idx % 2]:
            st.button(
                label,
                help=tip,
                use_container_width=True,
                key=key,
                on_click=queue_report,
                args=(panel_key, mode, required_widget_keys),
            )


def get_feature_columns(panel_key: str):
    """固定三栏布局：观测台、报告、AI 对话。"""
    return st.columns([4, 8, 3])


def sync_text_widget_to_saved(widget_key: str, saved_key: str):
    """把当前输入框 widget 内容同步到持久状态。"""
    st.session_state[saved_key] = st.session_state.get(widget_key, "")


def restore_text_widget_from_saved(widget_key: str, saved_key: str):
    """
    在 text_area 创建前恢复 widget 内容。
    只有当 widget key 不存在时才恢复，避免覆盖用户本轮正在编辑的内容。
    """
    if widget_key not in st.session_state:
        st.session_state[widget_key] = st.session_state.get(saved_key, "")


def persistent_text_area(
    label: str,
    placeholder: str,
    height: int,
    widget_key: str,
    saved_key: str,
):
    """代码输入框：用独立 saved_key 保存内容，避免切换页面或全屏后丢失。"""
    restore_text_widget_from_saved(widget_key, saved_key)

    value = st.text_area(
        label,
        placeholder=placeholder,
        height=height,
        key=widget_key,
        label_visibility="collapsed",
    )

    st.session_state[saved_key] = value
    return value



def persist_all_code_inputs():
    """
    进入全屏报告前主动保存所有可能已经填写的代码。
    注意这里只写入 *_saved 持久状态，不修改任何 widget key。
    """
    mapping = {
        "func_code": "func_code_saved",
        "scr_code": "scr_code_saved",
        "diff_code_a": "diff_code_a_saved",
        "diff_code_b": "diff_code_b_saved",
    }

    for widget_key, saved_key in mapping.items():
        if widget_key in st.session_state:
            st.session_state[saved_key] = st.session_state.get(widget_key, "")


def extract_stream_text(chunk) -> str:
    """
    只提取最终可展示文本，彻底忽略 reasoning_content。

    DeepSeek / OpenAI 兼容接口的流式对象里可能同时存在：
    - delta.content：真正要展示给用户的回答正文；
    - delta.reasoning_content：模型推理过程/思考内容，不应该出现在页面上。

    因此本函数只读取 content，不读取 reasoning_content，也不直接 str(chunk)。
    """
    if chunk is None:
        return ""

    # 如果上游本来就返回字符串，直接使用。
    if isinstance(chunk, str):
        return chunk

    # 兼容字典格式：{"choices": [{"delta": {"content": "..."}}]}
    if isinstance(chunk, dict):
        try:
            choices = chunk.get("choices") or []
            if not choices:
                return ""
            delta = choices[0].get("delta") or {}
            content = delta.get("content")
            return content if isinstance(content, str) else ""
        except Exception:
            return ""

    # 兼容 ChatCompletionChunk 对象格式：chunk.choices[0].delta.content
    try:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            return ""

        delta = getattr(choices[0], "delta", None)
        if delta is None:
            return ""

        content = getattr(delta, "content", None)
        return content if isinstance(content, str) else ""
    except Exception:
        return ""

    # 兜底：只接受对象自身的 content 字段，仍然不读取 reasoning_content。
    try:
        content = getattr(chunk, "content", None)
        if isinstance(content, str):
            return content
    except Exception:
        pass

    return ""

def render_stream_to_placeholder(stream, placeholder) -> str:
    """
    手动消费流式输出，并不断刷新指定 placeholder。
    用这个函数替代 st.write_stream，避免把 ChatCompletionChunk 对象原样显示出来。
    """
    full_text = ""

    for chunk in stream:
        text = extract_stream_text(chunk)
        if not text:
            continue
        full_text += text
        placeholder.markdown(full_text)

    return full_text


def stream_to_fixed_report_box(stream, title_key: str, content_key: str, title: str, height: int = 800):
    """
    中间报告区专用：
    - 流式显示报告；
    - 只提取大模型返回的文本字段，不显示 ChatCompletionChunk 对象；
    - 报告内容保存到 session_state；
    - 后续右侧 AI 对话触发 rerun 时，中间报告不会消失。
    """
    st.session_state[title_key] = title

    if title:
        st.markdown(title)

    with st.container(height=height, border=True):
        placeholder = st.empty()
        full_text = render_stream_to_placeholder(stream, placeholder)

        if not full_text.strip():
            placeholder.info("没有收到有效回复，请稍后重试。")

    st.session_state[content_key] = full_text
    return full_text

def show_saved_report(title_key: str, content_key: str, empty_message: str = "等待生成报告...", height: int = 800):
    """
    中间报告区专用：
    - 没有新生成任务时，优先展示上一次已经生成的报告；
    - 没有历史报告时，展示占位提示。
    """
    saved_title = st.session_state.get(title_key, "")
    saved_content = st.session_state.get(content_key, "")

    if saved_title:
        st.markdown(saved_title)

    with st.container(height=height, border=True):
        if saved_content.strip():
            st.markdown(saved_content)
        else:
            st.markdown(
                f'<p style="color:#64748B;text-align:center;padding-top:320px;">{empty_message}</p>',
                unsafe_allow_html=True,
            )


def reset_report(title_key: str, content_key: str):
    """只清空中间报告，不影响右侧 AI 对话。"""
    st.session_state[title_key] = ""
    st.session_state[content_key] = ""
    st.rerun()


REPORT_REGISTRY = {
    "func": {
        "page_title": "函数分析报告",
        "title_key": "func_report_title",
        "content_key": "func_report_content",
    },
    "script": {
        "page_title": "脚本审计报告",
        "title_key": "script_report_title",
        "content_key": "script_report_content",
    },
    "diff": {
        "page_title": "双版本对比报告",
        "title_key": "diff_report_title",
        "content_key": "diff_report_content",
    },
}


def get_query_value(name: str) -> str:
    """兼容新旧 Streamlit 的 query params 读取方式。"""
    try:
        value = st.query_params.get(name, "")
        if isinstance(value, list):
            return value[0] if value else ""
        return value or ""
    except Exception:
        try:
            params = st.experimental_get_query_params()
            value = params.get(name, [""])
            return value[0] if isinstance(value, list) and value else ""
        except Exception:
            return ""


def set_query_value(name: str, value: str):
    """兼容新旧 Streamlit 的 query params 写入方式。"""
    try:
        st.query_params[name] = value
    except Exception:
        try:
            st.experimental_set_query_params(**{name: value})
        except Exception:
            pass


def clear_query_value(name: str):
    """兼容新旧 Streamlit 的 query params 清除方式。"""
    try:
        if name in st.query_params:
            del st.query_params[name]
    except Exception:
        try:
            st.experimental_set_query_params()
        except Exception:
            pass


def open_fullscreen_report(report_key: str):
    """
    进入全屏报告视图。
    注意：这里不能修改 st.session_state.active_page。
    因为 active_page 已经绑定给 st.radio(key="active_page")，
    在控件实例化之后再手动赋值会触发 StreamlitAPIException。

    进入全屏前需要先保存当前代码输入，避免全屏页不渲染输入框时被 Streamlit 清理。
    """
    persist_all_code_inputs()
    set_query_value("fullscreen_report", report_key)
    st.rerun()


def close_fullscreen_report():
    """
    退出全屏报告视图，返回报告所属功能页。
    不清空任何代码输入框或报告内容。
    这里可以修改 active_page，因为全屏视图会在 st.radio 创建之前 st.stop()。
    """
    report_key = get_query_value("fullscreen_report")
    return_page = REPORT_PAGE_MAP.get(report_key, st.session_state.get("active_page", PAGE_HOME))
    clear_query_value("fullscreen_report")
    st.session_state.active_page = return_page
    st.rerun()


def render_fullscreen_report_if_needed():
    """
    如果 URL 中存在 fullscreen_report 参数，则进入全屏报告视图。
    该视图只展示报告和返回按钮，不加载下方三栏页面。
    """
    report_key = get_query_value("fullscreen_report")
    if report_key not in REPORT_REGISTRY:
        return

    report_meta = REPORT_REGISTRY[report_key]
    title_key = report_meta["title_key"]
    content_key = report_meta["content_key"]

    saved_title = st.session_state.get(title_key, "")
    saved_content = st.session_state.get(content_key, "")

    return_page_label = REPORT_PAGE_MAP.get(report_key, PAGE_HOME)

    top_left, top_mid, top_right = st.columns([2, 8, 2])
    with top_left:
        if st.button(f"← 返回{return_page_label.replace('  ', ' ')}", key="back_from_fullscreen_report", use_container_width=True):
            close_fullscreen_report()

    st.title(f"📖 报告｜{report_meta['page_title']}")

    if saved_title:
        st.markdown(f'<div class="fullscreen-report-title">{saved_title}</div>', unsafe_allow_html=True)

    with st.container(height=920, border=True):
        if saved_content.strip():
            st.markdown(saved_content)
        else:
            st.info("当前还没有报告，请返回后先生成报告。")

    st.stop()


def independent_ai_chat_panel(panel_key: str):
    """
    右侧独立 AI 对话区：
    - 不读取左侧代码；
    - 不读取中间报告；
    - 不修改任何报告相关 session_state；
    - 只根据用户输入的普通 prompt 进行问答。

    注意：原项目 CodeLensAI.stream_chat 的调用方式是：
        stream_chat(code, hist, role_hint=...)
    因此这里必须使用位置参数传入空字符串和独立聊天历史，不能写 hist=xxx。
    """
    history_key = "independent_ai_chat"

    st.subheader("💬 AI 对话")
    st.caption("不自动读取代码或报告。")

    clear_key = f"clear_independent_ai_chat_{panel_key}"
    prompt_key = f"prompt_independent_ai_chat_{panel_key}"
    send_key = f"send_independent_ai_chat_{panel_key}"

    if st.button("🗑️ 清空对话", key=clear_key, use_container_width=True):
        st.session_state[history_key] = []
        st.rerun()

    user_prompt = st.text_area(
        "问题",
        placeholder="输入你的问题...",
        height=115,
        key=prompt_key,
        label_visibility="collapsed",
    )

    send_clicked = st.button("发送", key=send_key, use_container_width=True)
    pending_prompt = user_prompt.strip() if send_clicked and user_prompt.strip() else ""

    if send_clicked and not user_prompt.strip():
        st.warning("请输入内容后再发送。")

    # 先展示已有历史。
    with st.container(height=520, border=True):
        if not st.session_state[history_key] and not pending_prompt:
            st.info("这里可以单独提问，不会影响报告。")

        for msg in st.session_state[history_key]:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])

        if pending_prompt:
            # 只更新右侧对话历史，不触碰中间报告区状态。
            st.session_state[history_key].append({"role": "user", "content": pending_prompt})

            with st.chat_message("user"):
                st.markdown(pending_prompt)

            with st.chat_message("assistant"):
                with st.spinner("正在回复..."):
                    independent_history = st.session_state[history_key]

                    try:
                        # 与原代码签名保持一致：stream_chat(code, hist, role_hint=role)
                        # code 传空字符串，确保不携带左侧代码上下文。
                        apply_model_to_engine(st.session_state.ai_engine, get_selected_model_id())
                        stream = st.session_state.ai_engine.stream_chat(
                            "",
                            independent_history,
                            role_hint="你是一个普通问答助手。只回答用户输入的问题，不读取页面代码或报告。不要输出思考过程，只输出最终答案。",
                        )
                    except TypeError:
                        # 兼容某些项目中 stream_chat 只接受两个位置参数的实现。
                        stream = st.session_state.ai_engine.stream_chat("", independent_history)

                    placeholder = st.empty()
                    reply = render_stream_to_placeholder(stream, placeholder)

                    if not reply.strip():
                        reply = "没有收到有效回复，请稍后重试。"
                        placeholder.warning(reply)

            st.session_state[history_key].append({"role": "assistant", "content": reply})



FUNC_MODE_TITLES = {
    "func_comment": "代码注释解析",
    "func_design": "设计说明",
    "func_optimize": "优化建议",
    "func_knowledge": "知识点说明",
}

SCRIPT_MODE_TITLES = {
    "script_structure": "代码结构说明",
    "script_api": "函数接口说明",
    "script_complexity": "复杂度分析",
    "script_security": "安全检查",
}

DIFF_MODE_TITLES = {
    "diff_overview": "功能对比",
    "diff_approach": "实现思路对比",
    "diff_performance": "性能对比",
    "diff_quality": "代码质量对比",
}


def build_function_prompt(
    code: str,
    mode: str,
    language_label: str,
    language_code: str,
    comment_marker: str,
) -> str:
    common = f"""
请基于用户给出的 {language_label} 函数或方法代码生成报告。要求：
1. 报告必须以代码为依据，不要脱离代码泛泛而谈。
2. 代码块使用 `{language_code}` 标记。
3. 注释请使用该语言常用注释符号；当前建议使用 `{comment_marker}`。
4. 不要输出思考过程、推理草稿或 reasoning_content。
5. 文字要直接、实用，不要使用夸张宣传式表达。
"""

    if mode == "func_comment":
        task = f"""
任务：生成代码注释解析。
输出结构：
### 1. 注释版代码
- 在代码块中输出原代码。
- 尽量不增删原代码行，不改变缩进。
- 在关键代码行后使用 `{comment_marker}` 写中文注释。
- 如果是 C、C++、Java 或 JavaScript，可使用行尾 `//` 注释；如果是 Python，可使用 `#` 注释。

### 2. 执行流程
- 按代码执行顺序说明主要步骤。
"""
    elif mode == "func_design":
        task = f"""
任务：说明函数或方法的设计思路。
输出结构：
### 1. 关键代码注释
- 先输出一段带 `{comment_marker}` 注释的代码。
- 不必每一行都注释，但要保留原代码顺序和缩进，重点标出核心判断、循环、数据处理和返回值。

### 2. 设计说明
- 说明这段代码解决什么问题。
- 说明主要变量、关键分支和数据流。
- 指出该实现的优点和限制。
"""
    elif mode == "func_optimize":
        task = f"""
任务：给出优化建议。
输出结构：
### 1. 需要关注的代码位置
- 先输出与性能、可读性或异常处理相关的关键代码行，并用 `{comment_marker}` 注释说明问题。
- 保留原代码缩进。

### 2. 优化建议
- 按“问题 / 原因 / 建议”说明。

### 3. 可选重构代码
- 如果确实有必要，再给出一版重构代码；否则说明无需重构。
"""
    else:
        task = f"""
任务：说明这段代码涉及的语法和知识点。
输出结构：
### 1. 代码中的知识点标注
- 先输出关键代码行，用 `{comment_marker}` 注释标出相关语法点。
- 保留原代码顺序和缩进。

### 2. 知识点说明
- 结合代码解释语法、库函数、控制流、异常处理或数据结构。
- 不要写与本代码无关的知识点。
"""

    return f"{common}\n{task}\n用户代码：\n```{language_code}\n{code}\n```"


def build_script_prompt(
    code: str,
    mode: str,
    language_label: str,
    language_code: str,
    comment_marker: str,
) -> str:
    common = f"""
请基于用户给出的完整 {language_label} 代码生成报告。要求：
1. 报告必须以代码为基础。
2. 如果代码较长，不要全文逐行复制；只摘出 import/include/package、全局变量、class/struct、function/method、主流程、关键循环、关键 SQL/请求/文件操作等结构行。
3. 摘出的代码必须保留原缩进，并使用 `{comment_marker}` 添加中文注释。
4. 不要输出思考过程、推理草稿或 reasoning_content。
5. 文字要直接、实用。
"""

    if mode == "script_structure":
        task = f"""
任务：说明代码结构。
输出结构：
### 1. 结构化代码摘录
- 按代码从上到下的顺序输出关键结构行。
- 对导入/包含、配置、类、函数/方法定义、主流程入口添加 `{comment_marker}` 注释。
- 长函数内部不必全部展开，可以只保留函数定义行和关键调用行。

### 2. 执行流程
- 说明代码从启动到结束的主要流程。

### 3. 模块职责
- 说明主要函数、类或模块分别负责什么。
"""
    elif mode == "script_api":
        task = f"""
任务：整理代码中的函数、方法、类或接口。
输出结构：
### 1. 定义摘录
- 按出现顺序输出 class/struct/interface/function/method 定义行，保留缩进，用 `{comment_marker}` 注释说明职责。

### 2. 参数与返回值
- 逐个说明主要函数/方法的输入、输出、副作用。

### 3. 调用关系
- 简要说明主要调用关系。
"""
    elif mode == "script_complexity":
        task = f"""
任务：分析复杂度。
输出结构：
### 1. 关键代码摘录
- 摘出循环、递归、批量请求、数据库查询、文件读取、排序、嵌套处理等代码位置。
- 保留缩进，用 `{comment_marker}` 注释说明复杂度来源。

### 2. 时间复杂度
- 分析主要函数或流程的时间复杂度。

### 3. 空间复杂度
- 分析主要数据结构和缓存占用。

### 4. 优化方向
- 给出可以实际落地的优化建议。
"""
    else:
        task = f"""
任务：做静态安全检查。
输出结构：
### 1. 风险代码摘录
- 摘出可能涉及密钥、SQL、文件路径、网络请求、反序列化、命令执行、异常吞噬、日志泄露等风险的代码行。
- 保留缩进，用 `{comment_marker}` 注释说明风险。

### 2. 风险清单
- 按“位置 / 风险 / 影响 / 修复建议”说明。

### 3. 修复示例
- 只对必要位置给出修复代码。
"""

    return f"{common}\n{task}\n用户代码：\n```{language_code}\n{code}\n```"


def build_diff_prompt(
    code_a: str,
    code_b: str,
    mode: str,
    language_label: str,
    language_code: str,
    comment_marker: str,
) -> str:
    common = f"""
请基于用户给出的两个 {language_label} 代码版本生成对比报告。要求：
1. 报告必须引用两个版本中的具体代码结构。
2. 先摘出与本次对比有关的关键代码，并用 `{comment_marker}` 注释说明差异。
3. 代码块使用 `{language_code}` 标记。
4. 不要输出思考过程、推理草稿或 reasoning_content。
5. 文字要直接、实用。
"""

    task_map = {
        "diff_overview": "比较两个版本的功能覆盖、输入输出、边界处理和缺失点。",
        "diff_approach": "比较两个版本的实现思路、模块划分、数据流和可维护性。",
        "diff_performance": "比较两个版本的时间复杂度、空间复杂度、I/O 成本和可能的性能瓶颈。",
        "diff_quality": "比较两个版本的可读性、健壮性、异常处理、安全风险和可测试性。",
    }
    task = task_map.get(mode, "比较两个版本的代码差异。")

    return f"""{common}
任务：{task}

输出结构：
### 1. 关键代码对照
- 分别摘出 Version A 和 Version B 中与本任务相关的代码。
- 保留原缩进，用 `{comment_marker}` 注释说明差异点。

### 2. 对比结论
- 按维度说明两个版本的差异。

### 3. 建议
- 明确推荐哪个版本，或说明应该如何合并两者优点。

Version A：
```{language_code}
{code_a}
```

Version B：
```{language_code}
{code_b}
```"""


def stream_report_from_prompt(prompt: str, role_hint: str):
    apply_model_to_engine(st.session_state.ai_engine, get_selected_model_id())
    hist = [{"role": "user", "content": prompt}]
    try:
        return st.session_state.ai_engine.stream_chat("", hist, role_hint=role_hint)
    except TypeError:
        return st.session_state.ai_engine.stream_chat("", hist)


def normalize_report_title(title: str) -> str:
    """把页面里带 Markdown 加粗符号的标题转成普通文本。"""
    return (title or "").replace("**", "").strip()


def save_report_history(
    report_key: str,
    report_page: str,
    report_title: str,
    report_content: str,
    language_label: str,
    language_code: str,
    model_id: str,
):
    """
    将生成的报告保存到 app.py 同目录下的 report_history 文件夹。

    每份报告保存为一个 JSON 文件，便于后续查看、删除或扩展导出功能。
    """
    if not report_content or not report_content.strip():
        return None

    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    file_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_report_key = re.sub(r"[^A-Za-z0-9_-]+", "_", report_key or "report")
    filename = f"{file_time}_{safe_report_key}_{uuid.uuid4().hex[:8]}.json"
    filepath = REPORT_HISTORY_DIR / filename

    data = {
        "id": filepath.stem,
        "created_at": created_at,
        "report_key": report_key,
        "report_page": report_page,
        "report_title": normalize_report_title(report_title),
        "language_label": language_label,
        "language_code": language_code,
        "model_id": model_id,
        "content": report_content,
    }

    filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return filepath


def list_report_history() -> list[dict]:
    """读取历史报告目录中的报告元信息，按时间倒序排列。"""
    REPORT_HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    reports: list[dict] = []
    for path in REPORT_HISTORY_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            data["_path"] = str(path)
            data["_filename"] = path.name
            data["_mtime"] = path.stat().st_mtime
            reports.append(data)
        except Exception:
            continue

    reports.sort(key=lambda item: item.get("_mtime", 0), reverse=True)
    return reports


def load_report_history_file(filepath: str) -> dict | None:
    """读取单个历史报告文件。"""
    try:
        path = Path(filepath)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def delete_report_history_file(filepath: str):
    """删除单个历史报告文件。"""
    try:
        path = Path(filepath)
        if path.exists() and path.parent.resolve() == REPORT_HISTORY_DIR.resolve():
            path.unlink()
            return True
    except Exception:
        pass
    return False


def render_history_page():
    """历史报告页面：查看已保存的报告。"""
    st.subheader("历史报告")
    st.caption(f"报告会自动保存到：`{REPORT_HISTORY_DIR}`")

    reports = list_report_history()

    total_count = len(reports)
    lang_count = len({item.get("language_label", "") for item in reports if item.get("language_label")})
    type_count = len({item.get("report_page", "") for item in reports if item.get("report_page")})
    latest_time = reports[0].get("created_at", "-") if reports else "-"

    s1, s2, s3, s4 = st.columns(4)
    s1.markdown(
        f'<div class="history-summary-card"><div class="label">报告总数</div><div class="value">{total_count}</div></div>',
        unsafe_allow_html=True,
    )
    s2.markdown(
        f'<div class="history-summary-card"><div class="label">覆盖语言</div><div class="value">{lang_count}</div></div>',
        unsafe_allow_html=True,
    )
    s3.markdown(
        f'<div class="history-summary-card"><div class="label">报告类型</div><div class="value">{type_count}</div></div>',
        unsafe_allow_html=True,
    )
    s4.markdown(
        f'<div class="history-summary-card"><div class="label">最近生成</div><div class="value" style="font-size:0.92rem;">{latest_time}</div></div>',
        unsafe_allow_html=True,
    )

    toolbar_left, toolbar_mid, toolbar_right = st.columns([2, 6, 2])
    with toolbar_left:
        if st.button("刷新列表", key="refresh_report_history", use_container_width=True):
            st.rerun()

    if not reports:
        st.info("还没有历史报告。生成任意报告后，会自动保存到这里。")
        return

    def report_label(item: dict) -> str:
        created = item.get("created_at", "")
        page = item.get("report_page", "报告")
        title = item.get("report_title", "未命名报告")
        lang = item.get("language_label", "")
        return f"{created}｜{page}｜{title}｜{lang}"

    labels = [report_label(item) for item in reports]

    left_panel, right_panel = st.columns([3.2, 6.8])

    with left_panel:
        st.markdown("**报告列表**")
        selected_label = st.selectbox(
            "选择历史报告",
            options=labels,
            key="selected_history_report_label",
            label_visibility="collapsed",
        )

        selected_index = labels.index(selected_label)
        selected = reports[selected_index]
        selected_path = selected.get("_path", "")
        detail = load_report_history_file(selected_path) or selected

        st.markdown("**当前报告信息**")
        st.caption(f"文件：`{selected.get('_filename', '-')}`")
        st.caption(f"时间：{detail.get('created_at', '-')}")
        st.caption(f"类型：{detail.get('report_page', '-')}")
        st.caption(f"语言：{detail.get('language_label', '-')}")
        st.caption(f"模型：{detail.get('model_id', '-')}")

        st.write("")
        delete_col, download_col = st.columns(2)
        with delete_col:
            if st.button("删除", key="delete_selected_history_report", use_container_width=True):
                if delete_report_history_file(selected_path):
                    st.success("已删除。")
                    st.rerun()
                else:
                    st.warning("删除失败。")

        with download_col:
            st.download_button(
                "下载",
                data=detail.get("content", ""),
                file_name=f"{detail.get('id', 'report')}.md",
                mime="text/markdown",
                use_container_width=True,
            )

    with right_panel:
        title = detail.get("report_title", "未命名报告")
        meta_text = (
            f"生成时间：{detail.get('created_at', '-')} ｜ "
            f"类型：{detail.get('report_page', '-')} ｜ "
            f"语言：{detail.get('language_label', '-')} ｜ "
            f"模型：{detail.get('model_id', '-')}"
        )
        st.markdown(
            f"""
            <div class="history-detail-header">
                <div class="history-detail-title">{title}</div>
                <div class="history-detail-meta">{meta_text}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        with st.container(height=760, border=True):
            st.markdown(detail.get("content", ""))


def clear_pending_generation(panel_key: str):
    """清理当前报告生成任务。"""
    st.session_state[f"{panel_key}_pending_mode"] = ""


def report_toolbar(
    title_key: str,
    content_key: str,
    clear_button_key: str,
    fullscreen_button_key: str,
    report_key: str,
):
    """
    报告区工具栏：只操作中间报告，不影响右侧对话。
    - 清空报告按钮左移；
    - 原右侧按钮位置放置全屏报告按钮；按钮始终可点击，点击时再判断是否已有报告。
    """
    left, spacer, right = st.columns([2, 5, 3])

    with left:
        if st.button("清空报告", key=clear_button_key, use_container_width=True):
            reset_report(title_key, content_key)

    with right:
        if st.button(
            "全屏报告",
            key=fullscreen_button_key,
            use_container_width=True,
            help="全屏查看当前报告",
        ):
            if st.session_state.get(content_key, "").strip():
                open_fullscreen_report(report_key)
            else:
                st.warning("当前还没有报告，请先生成报告。")


# ============================================================
#  顶部标题与页面导航
# ============================================================
render_fullscreen_report_if_needed()

title_col, language_col, model_col = st.columns([6.4, 1.8, 1.8])
with title_col:
    st.markdown(
        '<div class="compact-top-title">CodeLens</div>'
        '<div class="compact-top-subtitle">代码分析工具</div>',
        unsafe_allow_html=True,
    )
with language_col:
    st.selectbox(
        "语言",
        options=list(LANGUAGE_OPTIONS.keys()),
        key="selected_language_label",
        help="选择当前输入代码的语言。静态指标和报告提示词会随语言调整。",
        label_visibility="collapsed",
    )
with model_col:
    selected_label = st.selectbox(
        "模型",
        options=list(DEEPSEEK_MODEL_OPTIONS.keys()),
        key="selected_ai_model_label",
        help="当前支持 DeepSeek V4 Pro 和 V4 Flash，后续可在配置中继续添加。",
        label_visibility="collapsed",
    )
    selected_model_id = DEEPSEEK_MODEL_OPTIONS[selected_label]
    if selected_model_id != st.session_state.get("applied_ai_model_id"):
        st.session_state.ai_engine = build_ai_engine(selected_model_id)
        st.session_state.applied_ai_model_id = selected_model_id

active_page = st.radio(
    "功能导航",
    PAGE_OPTIONS,
    horizontal=True,
    key="active_page",
    label_visibility="collapsed",
)

current_language_label = get_selected_language_label()
current_language_code = get_selected_language_code()
current_comment_marker = get_selected_comment_marker()


# ────── 首页 ──────
if active_page == PAGE_HOME:
    st.markdown(
        """
        <div class="home-hero-card">
            <div class="home-hero-title">应用目标</div>
            <p class="home-hero-text">
                CodeLens 面向代码学习、课程展示和小型项目维护场景，目标是把“看不懂代码、难以快速审查脚本、难以比较版本差异”这类问题，
                转换成结构化的 AI 分析报告。用户只需要选择语言、粘贴代码并点击分析按钮，就可以获得代码注释、设计说明、优化建议、
                复杂度分析、安全检查和版本对比结果。
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    use1, use2, use3 = st.columns(3)
    with use1:
        st.markdown(
            '<div class="home-mini-card">'
            '<h4>使用场景一：代码学习</h4>'
            '<p>适合初学者阅读函数或脚本，快速理解执行流程、关键语法和变量含义。</p>'
            '</div>',
            unsafe_allow_html=True,
        )
    with use2:
        st.markdown(
            '<div class="home-mini-card">'
            '<h4>使用场景二：代码审查</h4>'
            '<p>适合检查完整脚本的结构、复杂度、安全风险和可维护性问题。</p>'
            '</div>',
            unsafe_allow_html=True,
        )
    with use3:
        st.markdown(
            '<div class="home-mini-card">'
            '<h4>使用场景三：版本比较</h4>'
            '<p>适合比较两个代码版本的功能差异、实现思路、性能和代码质量。</p>'
            '</div>',
            unsafe_allow_html=True,
        )

    st.write("")

    cc1, cc2, cc3 = st.columns(3)
    with cc1:
        st.markdown(
            '<div class="feature-card-clean">'
            '<h3>函数分析</h3>'
            '<p>生成注释版代码、设计说明、优化建议和知识点说明。</p>'
            '</div>',
            unsafe_allow_html=True,
        )
    with cc2:
        st.markdown(
            '<div class="feature-card-clean">'
            '<h3>脚本分析</h3>'
            '<p>分析完整代码的结构、接口、复杂度和安全问题。</p>'
            '</div>',
            unsafe_allow_html=True,
        )
    with cc3:
        st.markdown(
            '<div class="feature-card-clean">'
            '<h3>历史报告</h3>'
            '<p>自动保存每次生成的报告，支持查看、删除和下载 Markdown。</p>'
            '</div>',
            unsafe_allow_html=True,
        )

    st.info("演示建议：先选择语言，再进入函数分析或脚本分析页生成报告，最后到历史报告页展示结果沉淀。")


# ────── 历史报告 ──────
elif active_page == PAGE_HISTORY:
    render_history_page()


# ────── 函数分析 ──────
elif active_page == PAGE_FUNC:
    code = st.session_state.get("func_code_saved", "")
    col_obs, col_report, col_chat = get_feature_columns("func")

    with col_obs:
        st.subheader("函数观测台")
        code = persistent_text_area(
            label="函数代码",
            placeholder=f"请粘贴一个 {current_language_label} 函数或方法...",
            height=427,
            widget_key="func_code",
            saved_key="func_code_saved",
        )

        with st.expander("代码指标", expanded=True):
            if code.strip():
                metrics_bar(code, current_language_code)
            else:
                st.caption("输入代码后会显示行数、函数/方法数量和敏感信息提示。")

        st.markdown("**生成报告**")
        report_button_grid([
            ("代码注释解析", "按代码顺序添加中文注释并说明流程", "func_comment", "fb_comment"),
            ("设计说明", "说明函数的设计思路和关键变量", "func_design", "fb_design"),
            ("优化建议", "查看性能、可读性和异常处理方面的改进点", "func_optimize", "fb_optimize"),
            ("知识点说明", "结合代码说明相关语法和知识点", "func_knowledge", "fb_knowledge"),
        ], "func", ["func_code"])

    with col_report:
        st.subheader("分析报告")
        report_toolbar("func_report_title", "func_report_content", "clear_func_report", "fullscreen_func_report", "func")

        triggered = st.session_state.get("func_pending_mode", "")
        if triggered:
            if not code.strip():
                st.warning("请先输入函数代码。")
                show_saved_report("func_report_title", "func_report_content", "请输入代码后再生成报告。")
                clear_pending_generation("func")
            else:
                title = f"**当前报告：{FUNC_MODE_TITLES.get(triggered, triggered)}**"
                prompt = build_function_prompt(code, triggered, current_language_label, current_language_code, current_comment_marker)
                with st.spinner("正在生成报告..."):
                    stream = stream_report_from_prompt(prompt, "你是代码分析助手。请只输出最终报告，不输出思考过程。")
                    generated_report = stream_to_fixed_report_box(stream, "func_report_title", "func_report_content", title)
                    save_report_history(
                        report_key=triggered,
                        report_page="函数分析",
                        report_title=title,
                        report_content=generated_report,
                        language_label=current_language_label,
                        language_code=current_language_code,
                        model_id=get_selected_model_id(),
                    )
                clear_pending_generation("func")
        else:
            show_saved_report("func_report_title", "func_report_content")

    with col_chat:
        independent_ai_chat_panel("func")


# ────── 脚本分析 ──────
elif active_page == PAGE_SCRIPT:
    code = st.session_state.get("scr_code_saved", "")
    col_obs, col_report, col_chat = get_feature_columns("script")

    with col_obs:
        st.subheader("脚本观测台")
        code = persistent_text_area(
            label="脚本代码",
            placeholder=f"请粘贴完整 {current_language_label} 代码...",
            height=427,
            widget_key="scr_code",
            saved_key="scr_code_saved",
        )

        with st.expander("代码指标", expanded=True):
            if code.strip():
                metrics_bar(code, current_language_code, show_secrets_detail=True)
            else:
                st.caption("输入代码后会显示行数、函数/方法数量和敏感信息提示。")

        st.markdown("**生成报告**")
        report_button_grid([
            ("代码结构说明", "按代码顺序说明导入、类、函数/方法和主流程", "script_structure", "sb_structure"),
            ("接口/函数说明", "整理函数、方法、类、接口的定义、参数、返回值和调用关系", "script_api", "sb_api"),
            ("复杂度分析", "分析循环、递归、批量处理和主要数据结构", "script_complexity", "sb_complexity"),
            ("安全检查", "检查密钥、SQL、请求、文件和异常处理风险", "script_security", "sb_security"),
        ], "script", ["scr_code"])

    with col_report:
        st.subheader("分析报告")
        report_toolbar("script_report_title", "script_report_content", "clear_script_report", "fullscreen_script_report", "script")

        triggered = st.session_state.get("script_pending_mode", "")
        if triggered:
            if not code.strip():
                st.warning("请先输入脚本代码。")
                show_saved_report("script_report_title", "script_report_content", "请输入脚本后再生成报告。")
                clear_pending_generation("script")
            else:
                title = f"**当前报告：{SCRIPT_MODE_TITLES.get(triggered, triggered)}**"
                prompt = build_script_prompt(code, triggered, current_language_label, current_language_code, current_comment_marker)
                with st.spinner("正在生成报告..."):
                    stream = stream_report_from_prompt(prompt, "你是代码分析助手。请只输出最终报告，不输出思考过程。")
                    generated_report = stream_to_fixed_report_box(stream, "script_report_title", "script_report_content", title)
                    save_report_history(
                        report_key=triggered,
                        report_page="脚本分析",
                        report_title=title,
                        report_content=generated_report,
                        language_label=current_language_label,
                        language_code=current_language_code,
                        model_id=get_selected_model_id(),
                    )
                clear_pending_generation("script")
        else:
            show_saved_report("script_report_title", "script_report_content")

    with col_chat:
        independent_ai_chat_panel("script")


# ────── 代码对比 ──────
elif active_page == PAGE_DIFF:
    code_a = st.session_state.get("diff_code_a_saved", "")
    code_b = st.session_state.get("diff_code_b_saved", "")
    col_obs, col_report, col_chat = get_feature_columns("diff")

    with col_obs:
        st.subheader("代码对比观测台")

        st.markdown("**版本 A**")
        code_a = persistent_text_area(
            label="代码 A",
            placeholder="请粘贴版本 A...",
            height=293,
            widget_key="diff_code_a",
            saved_key="diff_code_a_saved",
        )

        st.markdown("**版本 B**")
        code_b = persistent_text_area(
            label="代码 B",
            placeholder="请粘贴版本 B...",
            height=293,
            widget_key="diff_code_b",
            saved_key="diff_code_b_saved",
        )

        has_both = bool(code_a.strip() and code_b.strip())
        with st.expander("代码指标", expanded=has_both):
            if has_both:
                ma, mb = scan_code(code_a, current_language_code), scan_code(code_b, current_language_code)
                m1, m2 = st.columns(2)
                m3, m4 = st.columns(2)
                m1.metric("A 行数", ma["lines"])
                m2.metric("B 行数", mb["lines"], delta=f"{mb['lines'] - ma['lines']} 行")
                m3.metric("A 函数/方法", ma["functions"]["count"])
                m4.metric("B 函数/方法", mb["functions"]["count"], delta=f"{mb['functions']['count'] - ma['functions']['count']} 个")
            else:
                st.caption("输入两个版本后会显示对比指标。")

        st.markdown("**生成报告**")
        report_button_grid([
            ("功能对比", "比较功能覆盖、输入输出和边界情况", "diff_overview", "db_overview"),
            ("实现思路对比", "比较数据流、模块划分和可维护性", "diff_approach", "db_approach"),
            ("性能对比", "比较时间、空间和 I/O 成本", "diff_performance", "db_performance"),
            ("代码质量对比", "比较健壮性、安全性、可读性和测试难度", "diff_quality", "db_quality"),
        ], "diff", ["diff_code_a", "diff_code_b"])

    with col_report:
        st.subheader("对比报告")
        report_toolbar("diff_report_title", "diff_report_content", "clear_diff_report", "fullscreen_diff_report", "diff")

        triggered = st.session_state.get("diff_pending_mode", "")
        if triggered:
            if not (code_a.strip() and code_b.strip()):
                st.warning("请同时输入版本 A 和版本 B。")
                show_saved_report("diff_report_title", "diff_report_content", "请输入两个版本后再生成报告。")
                clear_pending_generation("diff")
            else:
                title = f"**当前报告：{DIFF_MODE_TITLES.get(triggered, triggered)}**"
                prompt = build_diff_prompt(code_a, code_b, triggered, current_language_label, current_language_code, current_comment_marker)
                with st.spinner("正在生成报告..."):
                    stream = stream_report_from_prompt(prompt, "你是代码对比助手。请只输出最终报告，不输出思考过程。")
                    generated_report = stream_to_fixed_report_box(stream, "diff_report_title", "diff_report_content", title)
                    save_report_history(
                        report_key=triggered,
                        report_page="代码对比",
                        report_title=title,
                        report_content=generated_report,
                        language_label=current_language_label,
                        language_code=current_language_code,
                        model_id=get_selected_model_id(),
                    )
                clear_pending_generation("diff")
        else:
            show_saved_report("diff_report_title", "diff_report_content")

    with col_chat:
        independent_ai_chat_panel("diff")

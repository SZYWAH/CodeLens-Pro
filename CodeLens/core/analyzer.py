# core/analyzer.py —— 代码静态分析器
import ast
import re


def count_lines(code: str) -> int:
    """统计有效代码行数（排除空行）"""
    return len([line for line in code.split("\n") if line.strip()])


def count_functions(code: str) -> dict:
    """统计函数定义数量及名称"""
    try:
        tree = ast.parse(code)
        funcs = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
        return {"count": len(funcs), "names": funcs}
    except SyntaxError:
        return {"count": 0, "names": [], "error": "代码存在语法错误，无法解析 AST"}


def detect_hardcoded_secrets(code: str) -> list:
    """正则扫描潜在硬编码敏感信息"""
    patterns = {
        "硬编码密码": r"(?:password|passwd|pwd)\s*=\s*['\"][^'\"]+['\"]",
        "API Key 泄露": r"(?:api[_-]?key|secret|token)\s*=\s*['\"][^'\"]+['\"]",
        "数据库连接串": r"(?:mysql|postgresql|mongodb)://[^'\"\s]+",
    }
    findings = []
    for label, pattern in patterns.items():
        matches = re.findall(pattern, code, re.IGNORECASE)
        for m in matches:
            findings.append({"type": label, "match": m})
    return findings


def static_scan(code: str) -> dict:
    """聚合静态分析结果，返回结构化指标"""
    return {
        "lines": count_lines(code),
        "functions": count_functions(code),
        "secrets_risk": detect_hardcoded_secrets(code),
    }

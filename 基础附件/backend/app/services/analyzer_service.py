from __future__ import annotations

import ast
import re


SECRET_PATTERNS = {
    "Password": r"(?i)(password|passwd|pwd)\s*[:=]\s*['\"][^'\"]{4,}['\"]",
    "API Key": r"(?i)(api[_-]?key|secret|token)\s*[:=]\s*['\"][^'\"]{8,}['\"]",
    "Database URL": r"(?i)(mysql|postgresql|mongodb)://[^'\"\s]+",
}


def _count_lines(code: str) -> int:
    return len([line for line in code.splitlines() if line.strip()])


def _scan_python_functions(code: str) -> dict:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return {
            "count": 0,
            "names": [],
            "error": f"SyntaxError: {exc.msg} at line {exc.lineno}",
        }

    names = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
    return {"count": len(names), "names": names, "classes": classes}


def _scan_generic_functions(code: str, language_code: str) -> dict:
    patterns = {
        "javascript": r"(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)",
        "java": r"(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{",
        "cpp": r"[\w:<>~*&\s]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{",
        "c": r"[\w*&\s]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{",
    }
    pattern = patterns.get(language_code, patterns["javascript"])
    names: list[str] = []
    for match in re.finditer(pattern, code):
        groups = [item for item in match.groups() if item]
        if groups:
            names.append(groups[0])
    return {"count": len(names), "names": names}


def _scan_secrets(code: str) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for label, pattern in SECRET_PATTERNS.items():
        for match in re.finditer(pattern, code):
            findings.append({"type": label, "match": match.group(0)})
    return findings


def scan_code(code: str, language_code: str = "python") -> dict:
    language_code = (language_code or "python").lower()
    functions = (
        _scan_python_functions(code)
        if language_code == "python"
        else _scan_generic_functions(code, language_code)
    )
    return {
        "lines": _count_lines(code),
        "functions": functions,
        "secrets_risk": _scan_secrets(code),
    }

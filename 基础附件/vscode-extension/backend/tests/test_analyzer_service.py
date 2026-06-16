from backend.app.services.analyzer_service import scan_code


def test_python_static_scan_counts_functions():
    result = scan_code("def a():\n    return 1\n\nasync def b():\n    return 2", "python")

    assert result["lines"] == 5
    assert result["functions"]["count"] == 2
    assert result["functions"]["names"] == ["a", "b"]


def test_static_scan_counts_blank_lines():
    result = scan_code("a = 1\n\nb = 2", "python")

    assert result["lines"] == 3


def test_python_static_scan_reports_syntax_error():
    result = scan_code("def broken(:\n    pass\n", "python")

    assert result["functions"]["count"] == 0
    assert "SyntaxError" in result["functions"]["error"]


def test_secret_scan_detects_common_risks():
    result = scan_code("password = 'secret1234'\napi_key = 'abcdef1234567890'\n", "python")

    assert len(result["secrets_risk"]) == 2

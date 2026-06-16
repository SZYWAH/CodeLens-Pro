from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from backend.app.config import PROJECT_ROOT, settings


DEEPSEEK_OFFICIAL_BASE_URL = "https://api.deepseek.com/v1"
USER_LLM_SETTINGS_FILE = PROJECT_ROOT / "storage" / "user_llm_settings.json"


def normalize_deepseek_key(value: str | None) -> str:
    return (value or "").strip()


def masked_key(value: str | None) -> str:
    key = normalize_deepseek_key(value)
    if not key:
        return ""
    if len(key) <= 8:
        return f"{key[:2]}****{key[-2:]}"
    return f"{key[:4]}****{key[-4:]}"


def _read_user_settings() -> dict[str, Any]:
    if not USER_LLM_SETTINGS_FILE.exists():
        return {}
    try:
        data = json.loads(USER_LLM_SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_user_settings(data: dict[str, Any]) -> None:
    USER_LLM_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USER_LLM_SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def user_deepseek_key() -> str:
    return normalize_deepseek_key(_read_user_settings().get("deepseek_api_key"))


def effective_deepseek_key() -> str:
    return user_deepseek_key() or normalize_deepseek_key(settings.deepseek_api_key)


def effective_deepseek_key_source() -> str:
    if user_deepseek_key():
        return "user"
    if normalize_deepseek_key(settings.deepseek_api_key):
        return "env"
    return "none"


def effective_deepseek_base_url() -> str:
    return DEEPSEEK_OFFICIAL_BASE_URL


def deepseek_balance_url() -> str:
    base_url = DEEPSEEK_OFFICIAL_BASE_URL
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]
    return f"{base_url}/user/balance"


def llm_key_status() -> dict[str, Any]:
    data = _read_user_settings()
    key = effective_deepseek_key()
    source = effective_deepseek_key_source()
    return {
        "configured": bool(key),
        "source": source,
        "masked_key": masked_key(key),
        "updated_at": data.get("updated_at") if source == "user" else None,
        "base_url": DEEPSEEK_OFFICIAL_BASE_URL,
    }


def test_deepseek_key(api_key: str | None = None) -> dict[str, Any]:
    key = normalize_deepseek_key(api_key) or effective_deepseek_key()
    if not key:
        return {
            "ok": False,
            "status": "Key 未配置",
            "detail": "请先填写 DeepSeek 官方 API Key。",
        }

    try:
        response = requests.get(
            deepseek_balance_url(),
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {key}",
            },
            timeout=8,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        return {
            "ok": False,
            "status": "连接测试失败",
            "detail": str(exc),
        }

    return {
        "ok": True,
        "status": "连接测试成功",
        "detail": "DeepSeek 官方余额接口已返回账户信息。",
        "balance": _parse_balance(data),
        "raw": data,
    }


def save_user_deepseek_key(api_key: str) -> dict[str, Any]:
    key = normalize_deepseek_key(api_key)
    if not key:
        return {
            "ok": False,
            "status": "Key 未配置",
            "detail": "请先填写 DeepSeek 官方 API Key。",
        }
    result = test_deepseek_key(key)
    if not result.get("ok"):
        return result

    _write_user_settings(
        {
            "deepseek_api_key": key,
            "updated_at": datetime.utcnow().isoformat(),
        }
    )
    return {
        **result,
        "key_status": llm_key_status(),
    }


def clear_user_deepseek_key() -> dict[str, Any]:
    if USER_LLM_SETTINGS_FILE.exists():
        USER_LLM_SETTINGS_FILE.unlink()
    return llm_key_status()


def _parse_balance(data: Any) -> dict[str, Any]:
    balance_infos = data.get("balance_infos") if isinstance(data, dict) else None
    total_balance = 0.0
    currency = ""
    if isinstance(balance_infos, list):
        for item in balance_infos:
            if not isinstance(item, dict):
                continue
            try:
                total_balance += float(item.get("total_balance", 0) or 0)
            except Exception:
                pass
            currency = currency or str(item.get("currency", "") or "")
    return {
        "currency": currency,
        "total_balance": total_balance,
    }

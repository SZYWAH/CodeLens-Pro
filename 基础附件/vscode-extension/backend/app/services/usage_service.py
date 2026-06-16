from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import requests

from backend.app.config import PROJECT_ROOT, settings
from backend.app.services.llm_settings_service import (
    deepseek_balance_url,
    effective_deepseek_key,
)


TOKENIZER_DIR = PROJECT_ROOT / "backend" / "app" / "resources" / "deepseek_v3_tokenizer"


def fetch_deepseek_balance() -> dict[str, Any]:
    api_key = effective_deepseek_key()
    if not api_key:
        return {
            "available": False,
            "key_configured": False,
            "status": "Key 未配置",
            "detail": "请先在设置页填写 DeepSeek 官方 API Key，或在 .env 中配置 DEEPSEEK_API_KEY。",
        }

    try:
        response = requests.get(
            deepseek_balance_url(),
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            timeout=8,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        return {
            "available": False,
            "key_configured": True,
            "status": "余额查询失败",
            "detail": str(exc),
        }

    balance_infos = data.get("balance_infos") if isinstance(data, dict) else None
    total_balance = 0.0
    currency = ""
    if isinstance(balance_infos, list):
        for item in balance_infos:
            try:
                total_balance += float(item.get("total_balance", 0) or 0)
            except Exception:
                pass
            currency = currency or str(item.get("currency", "") or "")

    return {
        "available": True,
        "key_configured": True,
        "status": "余额查询成功",
        "detail": "DeepSeek /user/balance 已返回账户余额。",
        "currency": currency,
        "total_balance": total_balance,
        "raw": data,
    }


@lru_cache(maxsize=1)
def _load_tokenizer():
    try:
        from transformers import AutoTokenizer
    except Exception:
        return None

    if not TOKENIZER_DIR.exists():
        return None

    try:
        return AutoTokenizer.from_pretrained(str(TOKENIZER_DIR), trust_remote_code=True)
    except Exception:
        return None


def count_tokens(text: str | None) -> int:
    if not text:
        return 0

    tokenizer = _load_tokenizer()
    if tokenizer is not None:
        return len(tokenizer.encode(text))

    return max(1, round(len(text) / 1.8))


def tokenizer_status() -> dict[str, Any]:
    tokenizer = _load_tokenizer()
    return {
        "available": tokenizer is not None,
        "source": str(TOKENIZER_DIR),
        "fallback": tokenizer is None,
        "method": "deepseek_v3_tokenizer" if tokenizer is not None else "char_estimate",
    }

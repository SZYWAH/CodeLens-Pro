from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(ENV_FILE)

MODEL_LABEL_ALIASES = {
    "dsV4flash": "DeepSeek-V4-Flash",
    "dsV4pro": "DeepSeek-V4-Pro",
}


def normalize_model_label(value: str) -> str:
    return MODEL_LABEL_ALIASES.get(value, value)


class Settings:
    app_name = "CodeLens Pro Demo"
    api_prefix = "/api"
    database_url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:@127.0.0.1:3306/codelens_demo?charset=utf8mb4",
    ).strip()
    deepseek_api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    deepseek_base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip().rstrip("/")
    deepseek_default_model = os.getenv("DEEPSEEK_DEFAULT_MODEL", "deepseek-v4-flash").strip()
    deepseek_default_model_label = normalize_model_label(os.getenv("DEEPSEEK_DEFAULT_MODEL_LABEL", "DeepSeek-V4-Flash").strip())
    default_language_label = os.getenv("CODELENS_DEFAULT_LANGUAGE", "Python").strip()


settings = Settings()

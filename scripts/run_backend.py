from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.usage_service import tokenizer_status


if __name__ == "__main__":
    print(f"startup tokenizer: {tokenizer_status()}", flush=True)
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, log_level="info")

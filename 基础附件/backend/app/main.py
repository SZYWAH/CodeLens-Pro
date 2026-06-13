from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes import router
from backend.app.config import settings
from backend.app.db import init_database


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:15173",
        "http://localhost:15173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    try:
        init_database()
        app.state.database_init_error = ""
    except Exception as exc:
        app.state.database_init_error = str(exc)


app.include_router(router)

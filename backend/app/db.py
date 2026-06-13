from __future__ import annotations

from contextlib import contextmanager

import pymysql
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlmodel import Session, SQLModel

from backend.app.config import PROJECT_ROOT, settings


engine = create_engine(settings.database_url, pool_pre_ping=True, echo=False)


def _server_connection_kwargs() -> tuple[dict, str]:
    url = make_url(settings.database_url)
    database = url.database or "codelens_demo"
    query = dict(url.query)
    charset = query.get("charset", "utf8mb4")
    kwargs = {
        "host": url.host or "127.0.0.1",
        "port": int(url.port or 3306),
        "user": url.username or "root",
        "password": url.password or "",
        "charset": charset,
        "autocommit": True,
    }
    return kwargs, database


def ensure_database_exists() -> None:
    kwargs, database = _server_connection_kwargs()
    with pymysql.connect(**kwargs) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{database}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )


def run_migrations_or_create_all() -> None:
    try:
        alembic_cfg = Config(str(PROJECT_ROOT / "alembic.ini"))
        alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)
        command.upgrade(alembic_cfg, "head")
    except Exception:
        # Demo-friendly fallback: if Alembic is unavailable or misconfigured,
        # still create the current schema so the local app can start.
        from backend.app import models  # noqa: F401

        SQLModel.metadata.create_all(engine)


def init_database() -> None:
    ensure_database_exists()
    run_migrations_or_create_all()


def check_database() -> tuple[bool, str]:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "connected"
    except Exception as exc:
        return False, str(exc)


def get_session():
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope():
    with Session(engine) as session:
        yield session

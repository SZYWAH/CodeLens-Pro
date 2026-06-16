from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("report_type", sa.String(length=24), nullable=False),
        sa.Column("mode", sa.String(length=64), nullable=False),
        sa.Column("language_label", sa.String(length=32), nullable=False),
        sa.Column("language_code", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=96), nullable=False),
        sa.Column("code_content", mysql.LONGTEXT(), nullable=True),
        sa.Column("code_a", mysql.LONGTEXT(), nullable=True),
        sa.Column("code_b", mysql.LONGTEXT(), nullable=True),
        sa.Column("content", mysql.LONGTEXT(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reports_created_at", "reports", ["created_at"])
    op.create_index("ix_reports_language_code", "reports", ["language_code"])
    op.create_index("ix_reports_language_label", "reports", ["language_label"])
    op.create_index("ix_reports_mode", "reports", ["mode"])
    op.create_index("ix_reports_report_type", "reports", ["report_type"])
    op.create_index("ix_reports_title", "reports", ["title"])

    op.create_table(
        "analysis_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_id", sa.String(length=32), nullable=True),
        sa.Column("lines", sa.Integer(), nullable=False),
        sa.Column("functions_count", sa.Integer(), nullable=False),
        sa.Column("functions_json", mysql.LONGTEXT(), nullable=True),
        sa.Column("secrets_json", mysql.LONGTEXT(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analysis_metrics_report_id", "analysis_metrics", ["report_id"])

    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_sessions_created_at", "chat_sessions", ["created_at"])
    op.create_index("ix_chat_sessions_title", "chat_sessions", ["title"])
    op.create_index("ix_chat_sessions_updated_at", "chat_sessions", ["updated_at"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=32), nullable=True),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("content", mysql.LONGTEXT(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])
    op.create_index("ix_chat_messages_role", "chat_messages", ["role"])
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"])

    op.create_table(
        "code_snippets",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("language_label", sa.String(length=32), nullable=False),
        sa.Column("language_code", sa.String(length=32), nullable=False),
        sa.Column("code_content", mysql.LONGTEXT(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_code_snippets_created_at", "code_snippets", ["created_at"])
    op.create_index("ix_code_snippets_language_code", "code_snippets", ["language_code"])
    op.create_index("ix_code_snippets_language_label", "code_snippets", ["language_label"])
    op.create_index("ix_code_snippets_title", "code_snippets", ["title"])


def downgrade() -> None:
    op.drop_table("code_snippets")
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
    op.drop_table("analysis_metrics")
    op.drop_table("reports")

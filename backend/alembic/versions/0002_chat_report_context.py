from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0002_chat_report_context"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_sessions", sa.Column("context_type", sa.String(length=24), nullable=False, server_default="general"))
    op.add_column("chat_sessions", sa.Column("report_id", sa.String(length=32), nullable=True))
    op.create_index("ix_chat_sessions_context_type", "chat_sessions", ["context_type"])
    op.create_index("ix_chat_sessions_report_id", "chat_sessions", ["report_id"])
    op.create_foreign_key(
        "fk_chat_sessions_report_id_reports",
        "chat_sessions",
        "reports",
        ["report_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.alter_column("chat_sessions", "context_type", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_chat_sessions_report_id_reports", "chat_sessions", type_="foreignkey")
    op.drop_index("ix_chat_sessions_report_id", table_name="chat_sessions")
    op.drop_index("ix_chat_sessions_context_type", table_name="chat_sessions")
    op.drop_column("chat_sessions", "report_id")
    op.drop_column("chat_sessions", "context_type")

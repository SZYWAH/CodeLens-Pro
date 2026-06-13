from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0003_agent_plans"
down_revision = "0002_chat_report_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_plans",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("session_id", sa.String(length=32), nullable=True),
        sa.Column("instruction", mysql.LONGTEXT(), nullable=True),
        sa.Column("summary", sa.String(length=500), nullable=False),
        sa.Column("assumptions_json", mysql.LONGTEXT(), nullable=True),
        sa.Column("warnings_json", mysql.LONGTEXT(), nullable=True),
        sa.Column("operations_json", mysql.LONGTEXT(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("apply_result", mysql.LONGTEXT(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_plans_created_at", "agent_plans", ["created_at"])
    op.create_index("ix_agent_plans_session_id", "agent_plans", ["session_id"])
    op.create_index("ix_agent_plans_source", "agent_plans", ["source"])
    op.create_index("ix_agent_plans_status", "agent_plans", ["status"])
    op.create_index("ix_agent_plans_updated_at", "agent_plans", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_plans_updated_at", table_name="agent_plans")
    op.drop_index("ix_agent_plans_status", table_name="agent_plans")
    op.drop_index("ix_agent_plans_source", table_name="agent_plans")
    op.drop_index("ix_agent_plans_session_id", table_name="agent_plans")
    op.drop_index("ix_agent_plans_created_at", table_name="agent_plans")
    op.drop_table("agent_plans")

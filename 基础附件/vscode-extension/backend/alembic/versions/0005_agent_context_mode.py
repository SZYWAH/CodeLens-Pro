from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0005_agent_context_mode"
down_revision = "0004_agent_selected_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_plans",
        sa.Column("context_mode", sa.String(length=24), nullable=True),
    )
    op.execute("UPDATE agent_plans SET context_mode = 'manual' WHERE context_mode IS NULL")
    op.create_index("ix_agent_plans_context_mode", "agent_plans", ["context_mode"])


def downgrade() -> None:
    op.drop_index("ix_agent_plans_context_mode", table_name="agent_plans")
    op.drop_column("agent_plans", "context_mode")

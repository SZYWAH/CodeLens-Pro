from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0004_agent_selected_files"
down_revision = "0003_agent_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_plans",
        sa.Column("selected_files_json", mysql.LONGTEXT(), nullable=True),
    )
    op.execute("UPDATE agent_plans SET selected_files_json = '[]' WHERE selected_files_json IS NULL")


def downgrade() -> None:
    op.drop_column("agent_plans", "selected_files_json")

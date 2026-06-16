from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0008_daily_work_logs"
down_revision = "0007_learning_card_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daily_work_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("log_date", sa.DateTime(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("content_markdown", mysql.LONGTEXT(), nullable=False),
        sa.Column("source_stats_json", mysql.LONGTEXT(), nullable=False),
        sa.Column("source_refs_json", mysql.LONGTEXT(), nullable=False),
        sa.Column("model", sa.String(length=96), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_daily_work_logs_log_date", "daily_work_logs", ["log_date"], unique=True)
    op.create_index("ix_daily_work_logs_generated_at", "daily_work_logs", ["generated_at"])
    op.create_index("ix_daily_work_logs_updated_at", "daily_work_logs", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_daily_work_logs_updated_at", table_name="daily_work_logs")
    op.drop_index("ix_daily_work_logs_generated_at", table_name="daily_work_logs")
    op.drop_index("ix_daily_work_logs_log_date", table_name="daily_work_logs")
    op.drop_table("daily_work_logs")

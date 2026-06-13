from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0009_learning_card_materials"
down_revision = "0008_daily_work_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_card_materials",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("card_id", sa.String(length=32), nullable=False),
        sa.Column("content_markdown", mysql.LONGTEXT(), nullable=False),
        sa.Column("source_links_json", mysql.LONGTEXT(), nullable=False),
        sa.Column("model", sa.String(length=96), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["learning_cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_card_materials_card_id", "learning_card_materials", ["card_id"], unique=True)
    op.create_index("ix_learning_card_materials_generated_at", "learning_card_materials", ["generated_at"])
    op.create_index("ix_learning_card_materials_updated_at", "learning_card_materials", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_learning_card_materials_updated_at", table_name="learning_card_materials")
    op.drop_index("ix_learning_card_materials_generated_at", table_name="learning_card_materials")
    op.drop_index("ix_learning_card_materials_card_id", table_name="learning_card_materials")
    op.drop_table("learning_card_materials")

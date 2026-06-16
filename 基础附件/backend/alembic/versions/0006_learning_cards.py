from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0006_learning_cards"
down_revision = "0005_agent_context_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_cards",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("explanation", mysql.LONGTEXT(), nullable=False),
        sa.Column("language_label", sa.String(length=32), nullable=False),
        sa.Column("difficulty", sa.String(length=24), nullable=False),
        sa.Column("tags_json", mysql.LONGTEXT(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=32), nullable=True),
        sa.Column("code_excerpt", mysql.LONGTEXT(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["title", "language_label", "difficulty", "source_type", "source_id", "status", "created_at", "updated_at"]:
        op.create_index(f"ix_learning_cards_{column}", "learning_cards", [column])


def downgrade() -> None:
    op.drop_table("learning_cards")

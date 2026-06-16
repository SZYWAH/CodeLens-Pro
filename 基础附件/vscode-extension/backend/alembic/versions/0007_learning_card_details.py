from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql


revision = "0007_learning_card_details"
down_revision = "0006_learning_cards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("learning_cards")}
    if "detail_markdown" not in columns:
        op.add_column("learning_cards", sa.Column("detail_markdown", mysql.LONGTEXT(), nullable=True))
    if "notes" not in columns:
        op.add_column("learning_cards", sa.Column("notes", mysql.LONGTEXT(), nullable=True))
    if "resource_links_json" not in columns:
        op.add_column("learning_cards", sa.Column("resource_links_json", mysql.LONGTEXT(), nullable=True))
    if "last_reviewed_at" not in columns:
        op.add_column("learning_cards", sa.Column("last_reviewed_at", sa.DateTime(), nullable=True))
    indexes = {index["name"] for index in inspector.get_indexes("learning_cards")}
    if "ix_learning_cards_last_reviewed_at" not in indexes:
        op.create_index("ix_learning_cards_last_reviewed_at", "learning_cards", ["last_reviewed_at"])


def downgrade() -> None:
    op.drop_index("ix_learning_cards_last_reviewed_at", table_name="learning_cards")
    op.drop_column("learning_cards", "last_reviewed_at")
    op.drop_column("learning_cards", "resource_links_json")
    op.drop_column("learning_cards", "notes")
    op.drop_column("learning_cards", "detail_markdown")

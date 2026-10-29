"""create widgets table

Revision ID: 0001_create_widgets_table
Revises:
Create Date: 2026-03-31 00:00:00
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_create_widgets_table"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create widgets table and supporting index."""

    op.create_table(
        "widgets",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=400), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_widgets_id", "widgets", ["id"], unique=False)


def downgrade() -> None:
    """Drop widgets table and index."""

    op.drop_index("ix_widgets_id", table_name="widgets")
    op.drop_table("widgets")

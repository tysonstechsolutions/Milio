"""Add user management columns

Revision ID: 002_user_mgmt
Revises: 001_initial
Create Date: 2024-01-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '002_user_mgmt'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Email verification
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('email_verification_token', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('email_verification_sent_at', sa.DateTime(), nullable=True))
    
    # Password reset
    op.add_column('users', sa.Column('password_reset_token', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('password_reset_expires_at', sa.DateTime(), nullable=True))
    
    # Account deletion
    op.add_column('users', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('deletion_requested_at', sa.DateTime(), nullable=True))
    
    # Create index for soft deletes
    op.create_index('idx_users_deleted_at', 'users', ['deleted_at'])


def downgrade() -> None:
    op.drop_index('idx_users_deleted_at')
    op.drop_column('users', 'deletion_requested_at')
    op.drop_column('users', 'deleted_at')
    op.drop_column('users', 'password_reset_expires_at')
    op.drop_column('users', 'password_reset_token')
    op.drop_column('users', 'email_verification_sent_at')
    op.drop_column('users', 'email_verification_token')
    op.drop_column('users', 'email_verified')

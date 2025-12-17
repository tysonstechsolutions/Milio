"""
Authentication module for Milio backend.
Implements JWT-based authentication with access and refresh tokens.

Usage:
    1. Copy this file to services/backend/app/auth.py
    2. Add imports to main.py
    3. Add auth routes to main.py
    4. Update existing routes to use get_user_id_from_token
"""

from datetime import datetime, timedelta
from typing import Optional
import os
import secrets
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session


# ============ Configuration ============

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    # Generate a random secret for development - NOT FOR PRODUCTION
    JWT_SECRET = secrets.token_urlsafe(32)
    print("[WARNING] JWT_SECRET not set - using random secret. Set JWT_SECRET in production!")

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRY_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRY_DAYS", "30"))

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bearer token scheme
bearer_scheme = HTTPBearer(auto_error=False)


# ============ Pydantic Models ============

class UserCreate(BaseModel):
    """User registration request."""
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    display_name: Optional[str] = Field(None, max_length=100)


class UserLogin(BaseModel):
    """User login request."""
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Token response."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenRefreshRequest(BaseModel):
    """Token refresh request."""
    refresh_token: str


class UserResponse(BaseModel):
    """User response (public info)."""
    id: str
    email: str
    display_name: Optional[str]
    created_at: datetime


# ============ Password Functions ============

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


# ============ Token Functions ============

def create_access_token(user_id: str, email: str) -> str:
    """Create a short-lived access token."""
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    """Create a long-lived refresh token."""
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ============ Dependency Functions ============

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependency to get the current authenticated user from JWT token.

    Usage in routes:
        @app.get("/protected")
        def protected_route(current_user: dict = Depends(get_current_user)):
            user_id = current_user["user_id"]
            ...
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(credentials.credentials)

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type. Use access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "user_id": payload["sub"],
        "email": payload.get("email"),
    }


def get_user_id_from_token(current_user: dict = Depends(get_current_user)) -> str:
    """
    Dependency to get just the user ID.
    Drop-in replacement for the old get_user_id function.

    Usage:
        # Replace this:
        x_user_id: str = Depends(get_user_id)

        # With this:
        user_id: str = Depends(get_user_id_from_token)
    """
    return current_user["user_id"]


# ============ Database Functions ============

def get_user_by_email(sess: Session, email: str) -> Optional[dict]:
    """Get user by email address."""
    row = sess.execute(
        text("SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = :email"),
        {"email": email.lower()}
    ).mappings().first()
    return dict(row) if row else None


def get_user_by_id(sess: Session, user_id: str) -> Optional[dict]:
    """Get user by ID."""
    row = sess.execute(
        text("SELECT id, email, display_name, created_at FROM users WHERE id = :id"),
        {"id": user_id}
    ).mappings().first()
    return dict(row) if row else None


def create_user_in_db(sess: Session, email: str, password: str, display_name: Optional[str] = None) -> dict:
    """Create a new user in the database."""
    user_id = "u_" + uuid.uuid4().hex
    password_hash = hash_password(password)
    now = datetime.utcnow()

    sess.execute(
        text("""
            INSERT INTO users (id, email, password_hash, display_name, created_at)
            VALUES (:id, :email, :password_hash, :display_name, :created_at)
        """),
        {
            "id": user_id,
            "email": email.lower(),
            "password_hash": password_hash,
            "display_name": display_name,
            "created_at": now,
        }
    )
    sess.commit()

    return {
        "id": user_id,
        "email": email.lower(),
        "display_name": display_name,
        "created_at": now,
    }


# ============ SQL Schema Update ============

AUTH_SCHEMA_SQL = """
-- Add auth columns to users table (run this migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
"""

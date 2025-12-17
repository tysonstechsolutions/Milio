"""
Rate limiting module for Milio backend.
Implements tiered rate limits for different endpoint types.

Usage:
    1. Copy this file to services/backend/app/rate_limiter.py
    2. pip install slowapi redis
    3. Import and setup in main.py

Setup in main.py:
    from app.rate_limiter import setup_rate_limiting, limiter

    app = FastAPI()
    setup_rate_limiting(app)

    # Add to routes:
    @app.post("/auth/login")
    @limiter.limit("5/minute")
    async def login(request: Request, ...):
        ...
"""

import os
from typing import Callable
from fastapi import FastAPI, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.responses import JSONResponse
import logging

logger = logging.getLogger(__name__)


# ============ Configuration ============

REDIS_URL = os.getenv("REDIS_URL")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"

# Rate limit tiers
RATE_LIMITS = {
    # Auth - strict to prevent brute force
    "auth_login": "5/minute",
    "auth_register": "3/minute",
    "auth_refresh": "10/minute",

    # Chat - moderate limits
    "chat_create": "10/minute",
    "chat_list": "60/minute",
    "message_send": "30/minute",
    "message_stream": "20/minute",
    "message_list": "60/minute",

    # Files - resource intensive
    "file_upload": "20/minute",
    "file_download": "60/minute",

    # Apps - AI generation is expensive
    "app_create": "10/minute",
    "app_generate": "5/minute",
    "app_list": "60/minute",

    # Default
    "default": "100/minute",
}


# ============ Key Function ============

def get_identifier(request: Request) -> str:
    """
    Get identifier for rate limiting.
    Uses user ID from JWT if available, otherwise IP.
    """
    auth_header = request.headers.get("Authorization", "")

    if auth_header.startswith("Bearer "):
        try:
            # Import here to avoid circular imports
            from app.auth import decode_token
            token = auth_header[7:]
            payload = decode_token(token)
            user_id = payload.get("sub")
            if user_id:
                return f"user:{user_id}"
        except Exception:
            pass

    # Fallback to IP
    client_ip = get_remote_address(request)
    return f"ip:{client_ip}"


# ============ Limiter Instance ============

def create_limiter() -> Limiter:
    """Create the rate limiter instance."""
    storage_uri = REDIS_URL if REDIS_URL else "memory://"

    limiter = Limiter(
        key_func=get_identifier,
        default_limits=["100/minute"],
        storage_uri=storage_uri,
        strategy="fixed-window",
        enabled=RATE_LIMIT_ENABLED,
    )

    logger.info(f"Rate limiter created with storage: {storage_uri}")
    return limiter


# Global instance
limiter = create_limiter()


# ============ Error Handler ============

def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Custom handler for rate limit exceeded."""
    retry_after = getattr(exc, "retry_after", 60)

    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "RATE_LIMITED",
                "message": "Too many requests. Please slow down.",
                "retry_after": retry_after,
            }
        },
        headers={
            "Retry-After": str(retry_after),
        }
    )


# ============ Setup Function ============

def setup_rate_limiting(app: FastAPI) -> Limiter:
    """
    Setup rate limiting for the FastAPI app.

    Usage:
        app = FastAPI()
        setup_rate_limiting(app)
    """
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    logger.info(f"Rate limiting enabled: {RATE_LIMIT_ENABLED}")
    return limiter


# ============ Decorator Helpers ============

def limit_auth(limit: str = "5/minute"):
    """Decorator for auth endpoints."""
    return limiter.limit(limit)


def limit_message(limit: str = "30/minute"):
    """Decorator for message endpoints."""
    return limiter.limit(limit)


def limit_upload(limit: str = "20/minute"):
    """Decorator for upload endpoints."""
    return limiter.limit(limit)


def limit_generate(limit: str = "5/minute"):
    """Decorator for AI generation endpoints."""
    return limiter.limit(limit)

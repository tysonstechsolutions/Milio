"""
Middleware for Milio backend.
"""

import time
import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.logging_config import get_logger, bind_request_context, clear_request_context


logger = get_logger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to log requests and add request IDs."""
    
    async def dispatch(self, request: Request, call_next):
        # Generate request ID
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        
        # Get user ID if authenticated
        user_id = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from app.auth import decode_token
                token = auth_header[7:]
                payload = decode_token(token)
                user_id = payload.get("sub")
            except Exception:
                pass
        
        # Bind context for logging
        bind_request_context(
            request_id=request_id,
            user_id=user_id,
            path=str(request.url.path),
            method=request.method,
        )
        
        # Log request start
        start_time = time.time()
        logger.info(
            "Request started",
            client_ip=request.client.host if request.client else None,
        )
        
        try:
            response = await call_next(request)
            
            # Log request completion
            duration_ms = (time.time() - start_time) * 1000
            logger.info(
                "Request completed",
                status_code=response.status_code,
                duration_ms=round(duration_ms, 2),
            )
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            
            return response
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            logger.error(
                "Request failed",
                error=str(e),
                duration_ms=round(duration_ms, 2),
            )
            raise
        
        finally:
            clear_request_context()

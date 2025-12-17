"""
Error handling for Milio backend.
Provides consistent error responses and optional Sentry integration.
"""

import os
import traceback
from typing import Optional, Dict, Any
from datetime import datetime

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from app.logging_config import get_logger


logger = get_logger(__name__)


# ============ Sentry Integration ============

SENTRY_DSN = os.getenv("SENTRY_DSN")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

_sentry_initialized = False

def init_sentry() -> bool:
    """Initialize Sentry error tracking if DSN is configured."""
    global _sentry_initialized
    
    if _sentry_initialized:
        return True
        
    if not SENTRY_DSN:
        logger.info("Sentry DSN not configured, error tracking disabled")
        return False
    
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=ENVIRONMENT,
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                SqlalchemyIntegration(),
            ],
            traces_sample_rate=0.1 if ENVIRONMENT == "production" else 1.0,
            send_default_pii=False,
            attach_stacktrace=True,
        )
        
        _sentry_initialized = True
        logger.info("Sentry initialized successfully", environment=ENVIRONMENT)
        return True
        
    except ImportError:
        logger.warning("sentry-sdk not installed, error tracking disabled")
        return False
    except Exception as e:
        logger.error("Failed to initialize Sentry", error=str(e))
        return False


def capture_exception(error: Exception, context: Dict[str, Any] = None) -> Optional[str]:
    """Capture an exception to Sentry and log it."""
    
    logger.error(
        "Exception captured",
        error_type=type(error).__name__,
        error_message=str(error),
        context=context,
        exc_info=True,
    )
    
    if _sentry_initialized:
        try:
            import sentry_sdk
            with sentry_sdk.push_scope() as scope:
                if context:
                    for key, value in context.items():
                        scope.set_extra(key, value)
                return sentry_sdk.capture_exception(error)
        except Exception:
            pass
    
    return None


# ============ Error Response Model ============

class ErrorResponse:
    """Standardized error response."""
    
    @staticmethod
    def create(
        code: str,
        message: str,
        status_code: int = 500,
        details: Dict[str, Any] = None,
        request_id: str = None,
    ) -> JSONResponse:
        content = {
            "error": {
                "code": code,
                "message": message,
                "timestamp": datetime.utcnow().isoformat(),
            }
        }
        
        if details:
            content["error"]["details"] = details
        
        if request_id:
            content["error"]["request_id"] = request_id
        
        return JSONResponse(status_code=status_code, content=content)


# ============ Exception Handlers ============

async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle FastAPI HTTPExceptions."""
    request_id = getattr(request.state, "request_id", None)
    
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }
    
    code = code_map.get(exc.status_code, "ERROR")
    
    logger.warning(
        "HTTP exception",
        status_code=exc.status_code,
        code=code,
        detail=exc.detail,
        path=str(request.url.path),
    )
    
    return ErrorResponse.create(
        code=code,
        message=str(exc.detail),
        status_code=exc.status_code,
        request_id=request_id,
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handle Pydantic validation errors."""
    request_id = getattr(request.state, "request_id", None)
    
    errors = []
    for error in exc.errors():
        loc = " -> ".join(str(x) for x in error["loc"])
        errors.append({
            "field": loc,
            "message": error["msg"],
            "type": error["type"],
        })
    
    logger.warning(
        "Validation error",
        errors=errors,
        path=str(request.url.path),
    )
    
    return ErrorResponse.create(
        code="VALIDATION_ERROR",
        message="Request validation failed",
        status_code=422,
        details={"errors": errors},
        request_id=request_id,
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle unexpected exceptions."""
    request_id = getattr(request.state, "request_id", None)
    
    capture_exception(exc, context={
        "path": str(request.url.path),
        "method": request.method,
        "request_id": request_id,
    })
    
    if ENVIRONMENT == "production":
        message = "An unexpected error occurred. Please try again later."
    else:
        message = f"{type(exc).__name__}: {str(exc)}"
    
    return ErrorResponse.create(
        code="INTERNAL_ERROR",
        message=message,
        status_code=500,
        request_id=request_id,
    )


# ============ Setup Function ============

def setup_error_handlers(app) -> None:
    """Configure error handlers for the FastAPI app."""
    from fastapi.exceptions import RequestValidationError
    
    init_sentry()
    
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    
    logger.info("Error handlers configured")

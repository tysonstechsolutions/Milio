"""
Pagination utilities for Milio API.
Supports both offset-based and cursor-based pagination.
"""

from typing import TypeVar, Generic, List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field
import base64
import json


T = TypeVar('T')


# ============ Pagination Parameters ============

class PaginationParams(BaseModel):
    """Common pagination parameters."""
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page")
    offset: int = Field(default=0, ge=0, description="Number of items to skip")


class CursorPaginationParams(BaseModel):
    """Cursor-based pagination parameters."""
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page")
    cursor: Optional[str] = Field(default=None, description="Pagination cursor")
    direction: str = Field(default="after", pattern="^(before|after)$")


# ============ Pagination Response ============

class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response."""
    items: List[Any]
    total: int
    limit: int
    offset: int
    has_more: bool


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """Cursor-based paginated response."""
    items: List[Any]
    next_cursor: Optional[str]
    prev_cursor: Optional[str]
    has_more: bool


# ============ Cursor Utilities ============

def encode_cursor(data: dict) -> str:
    """Encode pagination data into a cursor string."""
    json_str = json.dumps(data, default=str)
    return base64.urlsafe_b64encode(json_str.encode()).decode()


def decode_cursor(cursor: str) -> dict:
    """Decode a cursor string into pagination data."""
    try:
        json_str = base64.urlsafe_b64decode(cursor.encode()).decode()
        return json.loads(json_str)
    except Exception:
        raise ValueError("Invalid cursor")


def create_datetime_cursor(dt: datetime, id: str) -> str:
    """Create a cursor from datetime and ID (for stable sorting)."""
    return encode_cursor({
        "dt": dt.isoformat(),
        "id": id
    })


def parse_datetime_cursor(cursor: str) -> tuple:
    """Parse a datetime cursor into (datetime, id)."""
    data = decode_cursor(cursor)
    return datetime.fromisoformat(data["dt"]), data["id"]

"""
Input validation module for Milio backend.
Provides Pydantic models with strict validation rules.

Usage:
    1. Copy this file to services/backend/app/validators.py
    2. Import and use these models in main.py
"""

import re
import html
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator


# ============ Constants ============

MAX_MESSAGE_LENGTH = 32_000  # ~8k tokens worth of text
MAX_CHAT_TITLE_LENGTH = 200
MAX_APP_NAME_LENGTH = 100
MAX_PROMPT_LENGTH = 16_000   # AI generation prompts
MAX_ATTACHMENT_IDS = 10
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 50MB

ALLOWED_FILE_TYPES = {
    # Images
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    # Documents
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    # Audio (for future voice notes)
    "audio/mpeg",
    "audio/wav",
    "audio/webm",
    "audio/ogg",
}

# URL patterns
URL_PATTERN = re.compile(
    r'^https?://'
    r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'
    r'localhost|'
    r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'
    r'(?::\d+)?'
    r'(?:/?|[/?]\S+)$',
    re.IGNORECASE
)

DEEP_LINK_PATTERN = re.compile(r'^[a-zA-Z][a-zA-Z0-9+.-]*://.+$')

# ID patterns
CHAT_ID_PATTERN = re.compile(r'^c_[a-f0-9]{32}$')
APP_ID_PATTERN = re.compile(r'^app_[a-f0-9]{32}$')
FILE_ID_PATTERN = re.compile(r'^f_[a-f0-9]{32}$')
USER_ID_PATTERN = re.compile(r'^u_[a-f0-9]{32}$')


# ============ Chat Models ============

class ChatCreateRequestValidated(BaseModel):
    """Validated chat creation request."""
    title: Optional[str] = Field(
        None,
        max_length=MAX_CHAT_TITLE_LENGTH,
        description="Optional chat title"
    )

    @validator('title')
    def sanitize_title(cls, v):
        if v is None:
            return v
        v = ' '.join(v.split()).strip()
        v = ''.join(char for char in v if ord(char) >= 32 or char in '\n\t')
        return v if v else None


class ChatResponseValidated(BaseModel):
    """Chat response model."""
    id: str
    title: Optional[str]
    created_at: datetime


# ============ Message Models ============

class MessageCreateRequestValidated(BaseModel):
    """Validated message creation request."""
    content: str = Field(
        ...,
        min_length=1,
        max_length=MAX_MESSAGE_LENGTH,
        description="Message content"
    )
    attachment_ids: List[str] = Field(
        default=[],
        max_items=MAX_ATTACHMENT_IDS,
        description="List of attachment IDs"
    )

    @validator('content')
    def sanitize_content(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('Message content cannot be empty')
        v = v.replace('\x00', '')
        return v

    @validator('attachment_ids', each_item=True)
    def validate_attachment_id(cls, v):
        if not FILE_ID_PATTERN.match(v):
            raise ValueError(f'Invalid attachment ID format: {v}')
        return v


class MessageResponseValidated(BaseModel):
    """Message response model."""
    id: str
    role: str
    content: str
    attachments: List[str]
    created_at: datetime


# ============ App Models ============

class AppCreateRequestValidated(BaseModel):
    """Validated app creation request."""
    name: str = Field(
        ...,
        min_length=1,
        max_length=MAX_APP_NAME_LENGTH,
        description="App name"
    )
    icon_emoji: Optional[str] = Field(
        "🧩",
        max_length=10,
        description="Emoji icon for the app"
    )
    launch_url: Optional[str] = Field(
        None,
        max_length=2000,
        description="External URL or deep link"
    )

    @validator('name')
    def sanitize_name(cls, v):
        v = ' '.join(v.split()).strip()
        if not v:
            raise ValueError('App name cannot be empty')
        return v

    @validator('icon_emoji')
    def validate_emoji(cls, v):
        if v is None:
            return "🧩"
        v = v.strip()
        return v[:10] if v else "🧩"

    @validator('launch_url')
    def validate_url(cls, v):
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not (URL_PATTERN.match(v) or DEEP_LINK_PATTERN.match(v)):
            raise ValueError('Invalid URL or deep link format')
        return v


class AppGenerateRequestValidated(BaseModel):
    """Validated app generation request."""
    app_id: str = Field(..., description="App ID to generate for")
    prompt: str = Field(
        ...,
        min_length=10,
        max_length=MAX_PROMPT_LENGTH,
        description="App generation prompt"
    )

    @validator('app_id')
    def validate_app_id(cls, v):
        # Accept both old format (app_xxx) and new format without prefix
        if not (APP_ID_PATTERN.match(v) or re.match(r'^[a-f0-9]{32}$', v) or re.match(r'^a_[a-f0-9]{32}$', v)):
            raise ValueError('Invalid app ID format')
        return v

    @validator('prompt')
    def sanitize_prompt(cls, v):
        v = v.strip()
        if len(v) < 10:
            raise ValueError('Prompt must be at least 10 characters')

        # Block common prompt injection patterns
        dangerous_patterns = [
            r'ignore\s+(previous|above|all)\s+instructions',
            r'disregard\s+(previous|above|all)',
            r'forget\s+(everything|all|previous)',
            r'you\s+are\s+now\s+[a-z]+',
            r'new\s+instructions\s*:',
            r'system\s*:\s*',
            r'<\s*system\s*>',
            r'\[\s*SYSTEM\s*\]',
        ]

        for pattern in dangerous_patterns:
            if re.search(pattern, v, re.IGNORECASE):
                raise ValueError('Invalid prompt content')

        return v


class AppResponseValidated(BaseModel):
    """App response model."""
    id: str
    name: str
    icon_emoji: Optional[str]
    launch_url: Optional[str] = None
    created_at: datetime


# ============ File Upload Validation ============

def validate_file_upload(
    filename: str,
    content_type: str,
    size_bytes: int
) -> None:
    """
    Validate file upload parameters.
    Raises ValueError if validation fails.

    Usage:
        try:
            validate_file_upload(file.filename, file.content_type, len(content))
        except ValueError as e:
            raise HTTPException(400, str(e))
    """
    # Check file size
    if size_bytes <= 0:
        raise ValueError("File is empty")
    if size_bytes > MAX_FILE_SIZE_BYTES:
        max_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise ValueError(f"File too large. Maximum size is {max_mb}MB")

    # Check content type
    if content_type not in ALLOWED_FILE_TYPES:
        raise ValueError(f"File type '{content_type}' not allowed")

    # Check filename
    if not filename:
        raise ValueError("Filename is required")
    if len(filename) > 255:
        raise ValueError("Filename too long")

    # Check for path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        raise ValueError("Invalid filename")

    # Validate extension matches content type
    ext_map = {
        '.jpg': {'image/jpeg'},
        '.jpeg': {'image/jpeg'},
        '.png': {'image/png'},
        '.gif': {'image/gif'},
        '.webp': {'image/webp'},
        '.pdf': {'application/pdf'},
        '.txt': {'text/plain'},
        '.csv': {'text/csv'},
        '.md': {'text/markdown', 'text/plain'},
        '.json': {'application/json'},
        '.doc': {'application/msword'},
        '.docx': {'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
        '.mp3': {'audio/mpeg'},
        '.wav': {'audio/wav'},
        '.webm': {'audio/webm'},
    }

    if '.' in filename:
        ext = '.' + filename.rsplit('.', 1)[-1].lower()
        if ext in ext_map and content_type not in ext_map[ext]:
            raise ValueError(f"File extension doesn't match content type")


# ============ Sanitization Helpers ============

def sanitize_string(value: str, max_length: int = 1000) -> str:
    """General string sanitization."""
    if not value:
        return ""
    value = value.replace('\x00', '')
    value = ' '.join(value.split())
    return value[:max_length]


def sanitize_html(value: str) -> str:
    """Escape HTML entities to prevent XSS."""
    return html.escape(value)


def sanitize_for_sql_like(value: str) -> str:
    """Escape special characters for SQL LIKE queries."""
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


# ============ ID Validation ============

def validate_chat_id(chat_id: str) -> str:
    """Validate and return chat ID."""
    if not CHAT_ID_PATTERN.match(chat_id):
        raise ValueError('Invalid chat ID format')
    return chat_id


def validate_file_id(file_id: str) -> str:
    """Validate and return file ID."""
    if not FILE_ID_PATTERN.match(file_id):
        raise ValueError('Invalid file ID format')
    return file_id


def validate_app_id(app_id: str) -> str:
    """Validate and return app ID."""
    if not APP_ID_PATTERN.match(app_id):
        raise ValueError('Invalid app ID format')
    return app_id

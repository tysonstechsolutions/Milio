import os
import uuid
import json
from datetime import datetime, timedelta
from typing import Optional, List

from dotenv import load_dotenv
load_dotenv()

import boto3
import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Auth imports
from app.auth import (
    UserCreate, UserLogin, TokenResponse, TokenRefreshRequest, UserResponse,
    get_current_user, get_user_id_from_token,
    create_access_token, create_refresh_token, decode_token,
    verify_password, get_user_by_email, get_user_by_id, create_user_in_db,
    ACCESS_TOKEN_EXPIRE_MINUTES
)
from app.validators import validate_file_upload, ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES
from app.rate_limiter import setup_rate_limiting, limiter
from app.pagination import (
    PaginationParams,
    CursorPaginationParams,
    PaginatedResponse,
    CursorPaginatedResponse,
    create_datetime_cursor,
    parse_datetime_cursor,
)


DATABASE_URL = os.environ["DATABASE_URL"]
S3_ENDPOINT = os.environ["S3_ENDPOINT"]
S3_ACCESS_KEY = os.environ["S3_ACCESS_KEY"]
S3_SECRET_KEY = os.environ["S3_SECRET_KEY"]
S3_BUCKET = os.environ["S3_BUCKET"]
S3_REGION = os.environ.get("S3_REGION", "us-east-1")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

# Milio's personality and rules
SYSTEM_PROMPT = """You are Milio — a personal AI assistant.

Your goals:
- Be concise, practical, and helpful
- When files are attached, analyze them deeply
- If the user shows logs or errors, explain the root cause and give fixes
- Ask clarifying questions only when useful
- Do not mention being an AI model

You can analyze images, documents, and code.
"""

# JWT_SECRET is now managed in auth.py
GAS_API_KEY = os.environ.get("GAS_API_KEY", "")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

def db():
    sess = SessionLocal()
    try:
        yield sess
    finally:
        sess.close()

s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
)

app = FastAPI(title="Milio Backend")

# Setup rate limiting
setup_rate_limiting(app)

# ============ CORS Configuration ============

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")

def get_allowed_origins() -> list[str]:
    """Get allowed CORS origins based on environment."""
    env_origins = os.environ.get("ALLOWED_ORIGINS", "")
    
    if ENVIRONMENT == "production":
        if not env_origins:
            raise RuntimeError(
                "ALLOWED_ORIGINS environment variable is required in production. "
                "Set it to your frontend domains (comma-separated)."
            )
        origins = [o.strip() for o in env_origins.split(",") if o.strip()]
        if not origins:
            raise RuntimeError("ALLOWED_ORIGINS cannot be empty in production.")
        return origins
    else:
        # Development defaults
        default_origins = [
            "http://localhost:3000",
            "http://localhost:8081",
            "http://localhost:8000",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:8081",
            "http://127.0.0.1:8000",
            "exp://localhost:8081",  # Expo development
        ]
        if env_origins:
            custom_origins = [o.strip() for o in env_origins.split(",") if o.strip()]
            return list(set(default_origins + custom_origins))
        return default_origins

ALLOWED_ORIGINS = get_allowed_origins()

# Log allowed origins on startup
print(f"[CORS] Environment: {ENVIRONMENT}")
print(f"[CORS] Allowed origins: {ALLOWED_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "Accept",
        "Origin",
    ],
    expose_headers=[
        "X-Request-ID",
        "Retry-After",
    ],
    max_age=600,  # Cache preflight for 10 minutes
)

# Include routers
from app.routes import stt
app.include_router(stt.router)

# ---------- Tool Functions ----------
import time

# Gas price cache (TTL: 1 hour)
_GAS_CACHE = {"price": None, "ts": 0, "ttl": 3600}


def get_average_gas_price(location: str = "US") -> float:
    """Fetch current average gas price (per gallon) for the given location.
    Uses in-memory cache to avoid hammering the API.
    """
    global _GAS_CACHE

    # Check cache first
    now = time.time()
    if _GAS_CACHE["price"] is not None and (now - _GAS_CACHE["ts"]) < _GAS_CACHE["ttl"]:
        return _GAS_CACHE["price"]

    try:
        if GAS_API_KEY:
            # Example using API Ninjas gas price API
            resp = httpx.get(
                f"https://api.api-ninjas.com/v1/gasprices?country={location}",
                headers={"X-Api-Key": GAS_API_KEY},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                # API returns {"gasoline": 3.5, "diesel": 3.8, ...}
                price = data.get("gasoline") or data.get("regular_gasoline")
                if price:
                    _GAS_CACHE["price"] = float(price)
                    _GAS_CACHE["ts"] = now
                    return _GAS_CACHE["price"]
    except Exception as e:
        print(f"Gas price fetch error: {e}")

    # Fallback: use approximate current national average
    fallback_price = 3.25
    _GAS_CACHE["price"] = fallback_price
    _GAS_CACHE["ts"] = now
    return fallback_price


def choose_best_order(orders: list[dict], mpg: float = 25.0, per_mile_cost: float = 0.0, gas_price: float = None) -> dict:
    """Given a list of orders (each with distance (miles) and payout),
    compute which order yields the best net profit."""
    if gas_price is None:
        gas_price = get_average_gas_price()

    best_order = None
    best_net = -float('inf')

    for order in orders:
        miles = order.get('miles') or order.get('distance') or 0
        payout = order.get('payout') or order.get('pay') or 0
        # Calculate fuel cost for this order
        fuel_cost = (miles / mpg) * gas_price if mpg > 0 else 0
        vehicle_cost = miles * per_mile_cost  # additional per-mile costs (maintenance, etc.)
        net = payout - (fuel_cost + vehicle_cost)
        order['net_profit'] = round(net, 2)
        order['fuel_cost'] = round(fuel_cost, 2)
        if net > best_net:
            best_net = net
            best_order = order

    return best_order or {}


def parse_orders_from_text(text: str) -> tuple[list[dict], float]:
    """Parse order information from natural language text.
    Looks for patterns like '$X for Y miles' or 'Y miles for $X'

    Returns:
        tuple: (list of orders, confidence score 0.0-1.0)
    """
    import re
    orders = []
    seen_values = set()  # Track unique order values to avoid duplicates

    # Pattern: $X for Y miles or Y miles for $X
    # Also: $X payout, Y miles | Y mi for $X | order: Y miles, $X
    patterns = [
        (r'\$(\d+(?:\.\d+)?)\s*(?:for|payout)?\s*(\d+(?:\.\d+)?)\s*(?:miles?|mi)', 'payout_first'),  # $20 for 10 miles
        (r'(\d+(?:\.\d+)?)\s*(?:miles?|mi)\s*(?:for)?\s*\$(\d+(?:\.\d+)?)', 'miles_first'),  # 10 miles for $20
        (r'(\d+(?:\.\d+)?)\s*(?:miles?|mi)[,\s]+\$(\d+(?:\.\d+)?)', 'miles_first'),  # 10 miles, $20
    ]

    for pattern, order_type in patterns:
        matches = re.findall(pattern, text.lower())
        for match in matches:
            if order_type == 'payout_first':
                payout, miles = float(match[0]), float(match[1])
            else:
                miles, payout = float(match[0]), float(match[1])

            # Avoid duplicates
            value_key = (miles, payout)
            if value_key not in seen_values:
                seen_values.add(value_key)
                orders.append({
                    "id": f"Order {len(orders) + 1}",
                    "miles": miles,
                    "payout": payout
                })

    # Calculate confidence based on parsing quality
    confidence = 0.0
    if len(orders) >= 2:
        # Base confidence for finding multiple orders
        confidence = 0.6

        # Higher confidence if values are reasonable
        reasonable_orders = all(
            0.5 <= o["miles"] <= 100 and 1 <= o["payout"] <= 200
            for o in orders
        )
        if reasonable_orders:
            confidence += 0.2

        # Higher confidence if orders are distinct
        if len(orders) == len(seen_values):
            confidence += 0.1

        # Higher confidence if text explicitly mentions "order" or "spark"
        if "order" in text.lower() or "spark" in text.lower():
            confidence += 0.1

    elif len(orders) == 1:
        confidence = 0.3  # Low confidence with single order

    return orders, min(confidence, 1.0)


# ---------- DB bootstrap (MVP) ----------
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments_json TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon_emoji TEXT,
  launch_url TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS app_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
"""

@app.on_event("startup")
def startup():
    with engine.begin() as conn:
        conn.execute(text(SCHEMA_SQL))
    # ensure bucket exists
    try:
        s3.head_bucket(Bucket=S3_BUCKET)
    except Exception:
        s3.create_bucket(Bucket=S3_BUCKET)

# ---------- Models ----------
class AnonAuthResponse(BaseModel):
    user_id: str

class ChatCreateRequest(BaseModel):
    title: Optional[str] = None

class ChatResponse(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime

class MessageCreateRequest(BaseModel):
    content: str
    attachment_ids: List[str] = []

class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    attachments: List[str]
    created_at: datetime

class AppCreateRequest(BaseModel):
    name: str
    icon_emoji: Optional[str] = "🧩"
    launch_url: Optional[str] = None

class AppResponse(BaseModel):
    id: str
    name: str
    icon_emoji: Optional[str]
    launch_url: Optional[str] = None
    created_at: datetime

class AppGenerateRequest(BaseModel):
    app_id: str
    prompt: str

# ============ Authentication ============
# All authentication is now handled via JWT tokens in auth.py
# The get_user_id alias is provided for backwards compatibility during migration

get_user_id = get_user_id_from_token


@app.get("/health")
def health():
    return {"ok": True}

@app.post("/auth/anon", response_model=AnonAuthResponse)
def auth_anon(sess=Depends(db)):
    user_id = "u_" + uuid.uuid4().hex
    now = datetime.utcnow()
    sess.execute(
        text("INSERT INTO users (id, created_at) VALUES (:id, :created_at)"),
        {"id": user_id, "created_at": now},
    )
    sess.commit()
    return {"user_id": user_id}


# ---------- JWT Authentication Routes ----------
@app.post("/auth/register", response_model=TokenResponse)
@limiter.limit("3/minute")
async def register(request: Request, req: UserCreate, sess=Depends(db)):
    """Register a new user with email and password."""
    existing = get_user_by_email(sess, req.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = create_user_in_db(sess, req.email, req.password, req.display_name)
    access_token = create_access_token(user["id"], user["email"])
    refresh_token = create_refresh_token(user["id"])
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@app.post("/auth/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, req: UserLogin, sess=Depends(db)):
    """Login with email and password."""
    user = get_user_by_email(sess, req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    access_token = create_access_token(user["id"], user["email"])
    refresh_token = create_refresh_token(user["id"])
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@app.post("/auth/refresh", response_model=TokenResponse)
@limiter.limit("10/minute")
async def refresh_tokens(request: Request, req: TokenRefreshRequest, sess=Depends(db)):
    """Refresh access token using refresh token."""
    payload = decode_token(req.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=400, detail="Invalid token type")
    user_id = payload["sub"]
    user = get_user_by_id(sess, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    access_token = create_access_token(user["id"], user["email"])
    new_refresh_token = create_refresh_token(user["id"])
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@app.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user), sess=Depends(db)):
    """Get current user info."""
    user = get_user_by_id(sess, current_user["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ---------- Chats ----------
@app.post("/chats", response_model=ChatResponse)
def create_chat(req: ChatCreateRequest, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    chat_id = "c_" + uuid.uuid4().hex
    now = datetime.utcnow()
    sess.execute(
        text("INSERT INTO chats (id, user_id, title, created_at) VALUES (:id, :user_id, :title, :created_at)"),
        {"id": chat_id, "user_id": user_id, "title": req.title, "created_at": now},
    )
    sess.commit()
    return {"id": chat_id, "title": req.title, "created_at": now}

@app.get("/chats", response_model=List[ChatResponse])
def list_chats(sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    rows = sess.execute(
        text("SELECT id, title, created_at FROM chats WHERE user_id=:u ORDER BY created_at DESC"),
        {"u": user_id},
    ).mappings().all()
    return [dict(r) for r in rows]

# ---------- File upload/store ----------
@app.post("/files/upload")
async def upload_file(
    chat_id: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    sess=Depends(db),
    user_id: str = Depends(get_user_id_from_token),
):
    fid = "f_" + uuid.uuid4().hex
    now = datetime.utcnow()

    content = await file.read()
    size_bytes = len(content)
    if size_bytes == 0:
        raise HTTPException(400, "Empty upload")

    s3_key = f"{user_id}/{fid}/{file.filename}"
    s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=content, ContentType=file.content_type or "application/octet-stream")

    sess.execute(
        text("""INSERT INTO files (id, user_id, chat_id, filename, content_type, size_bytes, s3_key, created_at)
                VALUES (:id, :user_id, :chat_id, :filename, :content_type, :size_bytes, :s3_key, :created_at)"""),
        {
            "id": fid,
            "user_id": user_id,
            "chat_id": chat_id,
            "filename": file.filename,
            "content_type": file.content_type or "application/octet-stream",
            "size_bytes": size_bytes,
            "s3_key": s3_key,
            "created_at": now,
        },
    )
    sess.commit()

    return {"id": fid, "filename": file.filename, "content_type": file.content_type, "size_bytes": size_bytes}

@app.get("/files/{file_id}")
def download_file(file_id: str, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    row = sess.execute(
        text("SELECT s3_key, content_type, filename FROM files WHERE id=:id AND user_id=:u"),
        {"id": file_id, "u": x_user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(404, "File not found")

    obj = s3.get_object(Bucket=S3_BUCKET, Key=row["s3_key"])
    body = obj["Body"].read()
    return Response(content=body, media_type=row["content_type"], headers={
        "Content-Disposition": f'inline; filename="{row["filename"]}"'
    })

# ---------- Messages + Claude analysis ----------
async def claude_analyze_message(
    content: str,
    attachment_blobs: list[dict],
    conversation_history: list[dict] = None
) -> str:
    """
    attachment_blobs: list of { "type": "image"|"document"|"video"|"other", "content_type": ..., "bytes_b64": ... , "filename": ... }
    conversation_history: list of {"role": "user"|"assistant", "content": "..."} for context
    For MVP: we send images + PDFs to Claude when possible, otherwise we just describe we stored it.
    """
    if not ANTHROPIC_API_KEY:
        return "Claude key not configured on server. Set ANTHROPIC_API_KEY."

    # Build content blocks for the new user message
    content_blocks = [{"type": "text", "text": content}]

    for att in attachment_blobs:
        if att["type"] == "image":
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": att["content_type"], "data": att["bytes_b64"]}
            })
        elif att["type"] == "document" and att["content_type"] == "application/pdf":
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": att["bytes_b64"]},
                "title": att.get("filename") or "document.pdf"
            })
        else:
            content_blocks.append({"type": "text", "text": f"[Stored attachment: {att.get('filename','file')} ({att['content_type']})]"})

    # Build conversation with history
    messages = []

    # Add conversation history (previous messages)
    if conversation_history:
        for msg in conversation_history:
            messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })

    # Add the new user message with attachments
    messages.append({"role": "user", "content": content_blocks})

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1024,
        "system": SYSTEM_PROMPT,
        "messages": messages
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
            )
            if r.status_code >= 400:
                print(f"[Claude API Error] Status: {r.status_code}, Response: {r.text[:500]}")
                error_detail = "I'm having trouble connecting to my brain right now. Please try again."
                if r.status_code == 401:
                    error_detail = "API authentication failed. Please check your configuration."
                elif r.status_code == 429:
                    error_detail = "I'm getting too many requests. Please wait a moment and try again."
                elif r.status_code >= 500:
                    error_detail = "The AI service is temporarily unavailable. Please try again later."
                raise HTTPException(503, error_detail)

            data = r.json()
            # Extract assistant text
            out = []
            for block in data.get("content", []):
                if block.get("type") == "text":
                    out.append(block.get("text", ""))
            return "\n".join(out).strip() or "(No response)"
    except httpx.TimeoutException:
        print("[Claude API Error] Request timed out")
        raise HTTPException(503, "The request took too long. Please try again with a shorter message.")
    except httpx.RequestError as e:
        print(f"[Claude API Error] Network error: {e}")
        raise HTTPException(503, "Network error connecting to AI service. Please check your connection.")

def guess_attachment_type(content_type: str) -> str:
    ct = (content_type or "").lower()
    if ct.startswith("image/"):
        return "image"
    if ct == "application/pdf":
        return "document"
    if ct.startswith("video/"):
        return "video"
    return "other"

import base64

async def generate_chat_title(user_message: str, assistant_response: str) -> str:
    """Generate a short 2-4 word title for a chat based on the first exchange."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-3-5-haiku-latest",
                    "max_tokens": 20,
                    "messages": [
                        {
                            "role": "user",
                            "content": f"Generate a 2-4 word title for this conversation. Reply with ONLY the title, no quotes or punctuation.\n\nUser: {user_message[:200]}\nAssistant: {assistant_response[:200]}"
                        }
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            title = data["content"][0]["text"].strip()
            # Clean up and limit length
            title = title.strip('"\'').title()
            if len(title) > 50:
                title = title[:47] + "..."
            return title
    except Exception as e:
        print(f"Failed to generate title: {e}")
        return "New Chat"

@app.post("/chats/{chat_id}/messages", response_model=List[MessageResponse])
async def send_message(chat_id: str, req: MessageCreateRequest, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    # verify chat and get current title
    chat = sess.execute(
        text("SELECT id, title FROM chats WHERE id=:c AND user_id=:u"),
        {"c": chat_id, "u": x_user_id},
    ).mappings().first()
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Load conversation history (most recent 20 messages for context)
    # Get latest 20 in DESC order, then reverse to chronological for AI
    history_rows = sess.execute(
        text("""SELECT role, content FROM messages
                WHERE chat_id=:c AND user_id=:u
                ORDER BY created_at DESC
                LIMIT 20"""),
        {"c": chat_id, "u": x_user_id},
    ).mappings().all()

    # Reverse to chronological order (oldest first for AI context)
    conversation_history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]

    now = datetime.utcnow()
    mid_user = "m_" + uuid.uuid4().hex
    sess.execute(
        text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                VALUES (:id,:chat_id,:user_id,:role,:content,:att,:created_at)"""),
        {
            "id": mid_user,
            "chat_id": chat_id,
            "user_id": user_id,
            "role": "user",
            "content": req.content,
            "att": json.dumps(req.attachment_ids),
            "created_at": now,
        },
    )

    # ---------- Tool Detection and Invocation ----------
    user_text = req.content.lower()

    # Detect Spark driver order optimization queries
    is_order_query = (
        ("which order" in user_text or "best order" in user_text or "should i take" in user_text)
        and ("spark" in user_text or "order" in user_text or "delivery" in user_text or "miles" in user_text)
    )

    if is_order_query:
        # Try to parse orders from the message with confidence scoring
        orders, confidence = parse_orders_from_text(req.content)

        # Minimum confidence threshold for automatic processing
        CONFIDENCE_THRESHOLD = 0.6

        if orders and len(orders) >= 2 and confidence >= CONFIDENCE_THRESHOLD:
            # High confidence - proceed with calculation
            gas_price = get_average_gas_price()
            best = choose_best_order(orders, mpg=25.0, per_mile_cost=0.08, gas_price=gas_price)

            if best:
                # Build all orders summary
                all_orders_summary = "\n".join([
                    f"• {o['id']}: {o.get('miles')} miles, ${o.get('payout')} pay → Net: ${o.get('net_profit', 0):.2f} (fuel cost: ${o.get('fuel_cost', 0):.2f})"
                    for o in orders
                ])

                recommendation = (
                    f"Based on current gas prices (~${gas_price:.2f}/gal) and assuming 25 MPG with $0.08/mile vehicle costs:\n\n"
                    f"{all_orders_summary}\n\n"
                    f"**Recommendation: {best['id']}** is your best choice with a net profit of **${best['net_profit']:.2f}**.\n\n"
                    f"This {best.get('miles')} mile trip for ${best.get('payout')} gives you the highest earnings after accounting for fuel (${best.get('fuel_cost', 0):.2f}) and vehicle costs."
                )

                # Save assistant reply to DB
                mid_assistant = "m_" + uuid.uuid4().hex
                now2 = datetime.utcnow()
                sess.execute(
                    text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                            VALUES (:id,:chat_id,:user_id,:role,:content,:att,:created_at)"""),
                    {
                        "id": mid_assistant,
                        "chat_id": chat_id,
                        "user_id": user_id,
                        "role": "assistant",
                        "content": recommendation,
                        "att": json.dumps([]),
                        "created_at": now2,
                    },
                )
                sess.commit()

                # Auto-generate title for new chats
                if len(conversation_history) == 0 and chat["title"] == "New Chat":
                    new_title = await generate_chat_title(req.content, recommendation)
                    sess.execute(
                        text("UPDATE chats SET title=:t WHERE id=:c"),
                        {"t": new_title, "c": chat_id},
                    )
                    sess.commit()

                return [
                    {"id": mid_user, "role": "user", "content": req.content, "attachments": req.attachment_ids, "created_at": now},
                    {"id": mid_assistant, "role": "assistant", "content": recommendation, "attachments": [], "created_at": now2},
                ]

        elif orders and confidence < CONFIDENCE_THRESHOLD:
            # Low confidence - ask for clarification
            clarification = (
                "I found some order information but I'm not fully confident in the details. "
                "Could you please confirm the orders in this format?\n\n"
                "**Order 1:** [miles] miles for $[payout]\n"
                "**Order 2:** [miles] miles for $[payout]\n\n"
                "For example: 'Order 1: 10 miles for $20, Order 2: 8 miles for $15'"
            )

            if orders:
                # Show what we found for confirmation
                found_orders = "\n".join([f"• {o['id']}: {o['miles']} miles, ${o['payout']}" for o in orders])
                clarification = (
                    f"I found these possible orders, but I want to make sure I have them right:\n\n"
                    f"{found_orders}\n\n"
                    f"Can you confirm these are correct, or provide the exact details?"
                )

            mid_assistant = "m_" + uuid.uuid4().hex
            now2 = datetime.utcnow()
            sess.execute(
                text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                        VALUES (:id,:chat_id,:user_id,:role,:content,:att,:created_at)"""),
                {
                    "id": mid_assistant,
                    "chat_id": chat_id,
                    "user_id": user_id,
                    "role": "assistant",
                    "content": clarification,
                    "att": json.dumps([]),
                    "created_at": now2,
                },
            )
            sess.commit()

            return [
                {"id": mid_user, "role": "user", "content": req.content, "attachments": req.attachment_ids, "created_at": now},
                {"id": mid_assistant, "role": "assistant", "content": clarification, "attachments": [], "created_at": now2},
            ]

    # Detect gas price query
    if "gas price" in user_text or "fuel price" in user_text or "cost of gas" in user_text:
        gas_price = get_average_gas_price()
        gas_response = f"The current average gas price is approximately **${gas_price:.2f} per gallon**.\n\nThis is the national average and may vary by location. Would you like me to help calculate costs for a specific trip?"

        mid_assistant = "m_" + uuid.uuid4().hex
        now2 = datetime.utcnow()
        sess.execute(
            text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                    VALUES (:id,:chat_id,:user_id,:role,:content,:att,:created_at)"""),
            {
                "id": mid_assistant,
                "chat_id": chat_id,
                "user_id": user_id,
                "role": "assistant",
                "content": gas_response,
                "att": json.dumps([]),
                "created_at": now2,
            },
        )
        sess.commit()

        if len(conversation_history) == 0 and chat["title"] == "New Chat":
            new_title = await generate_chat_title(req.content, gas_response)
            sess.execute(
                text("UPDATE chats SET title=:t WHERE id=:c"),
                {"t": new_title, "c": chat_id},
            )
            sess.commit()

        return [
            {"id": mid_user, "role": "user", "content": req.content, "attachments": req.attachment_ids, "created_at": now},
            {"id": mid_assistant, "role": "assistant", "content": gas_response, "attachments": [], "created_at": now2},
        ]

    # ---------- Standard Claude Analysis ----------
    # Load attachments bytes for Claude (only images + PDFs in MVP)
    attachment_blobs = []
    if req.attachment_ids:
        # Use IN clause with dynamic placeholders for compatibility
        placeholders = ",".join([f":id{i}" for i in range(len(req.attachment_ids))])
        params = {"u": user_id}
        params.update({f"id{i}": aid for i, aid in enumerate(req.attachment_ids)})
        rows = sess.execute(
            text(f"SELECT id, filename, content_type, s3_key FROM files WHERE user_id=:u AND id IN ({placeholders})"),
            params,
        ).mappings().all()
        for r in rows:
            obj = s3.get_object(Bucket=S3_BUCKET, Key=r["s3_key"])
            raw = obj["Body"].read()
            attachment_blobs.append({
                "type": guess_attachment_type(r["content_type"]),
                "content_type": r["content_type"],
                "filename": r["filename"],
                "bytes_b64": base64.b64encode(raw).decode("utf-8"),
            })

    assistant_text = await claude_analyze_message(req.content, attachment_blobs, conversation_history)

    mid_assistant = "m_" + uuid.uuid4().hex
    now2 = datetime.utcnow()
    sess.execute(
        text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                VALUES (:id,:chat_id,:user_id,:role,:content,:att,:created_at)"""),
        {
            "id": mid_assistant,
            "chat_id": chat_id,
            "user_id": user_id,
            "role": "assistant",
            "content": assistant_text,
            "att": json.dumps([]),
            "created_at": now2,
        },
    )
    sess.commit()

    # Auto-generate title for new chats (first message)
    if len(conversation_history) == 0 and chat["title"] == "New Chat":
        new_title = await generate_chat_title(req.content, assistant_text)
        sess.execute(
            text("UPDATE chats SET title=:t WHERE id=:c"),
            {"t": new_title, "c": chat_id},
        )
        sess.commit()

    return [
        {"id": mid_user, "role": "user", "content": req.content, "attachments": req.attachment_ids, "created_at": now},
        {"id": mid_assistant, "role": "assistant", "content": assistant_text, "attachments": [], "created_at": now2},
    ]

@app.get("/chats/{chat_id}/messages", response_model=List[MessageResponse])
def list_messages(chat_id: str, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    rows = sess.execute(
        text("""SELECT id, role, content, attachments_json, created_at
                FROM messages WHERE chat_id=:c AND user_id=:u ORDER BY created_at ASC"""),
        {"c": chat_id, "u": x_user_id},
    ).mappings().all()
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "attachments": json.loads(r["attachments_json"] or "[]"),
            "created_at": r["created_at"],
        })
    return out


# ---------- Streaming Messages ----------
@app.post("/chats/{chat_id}/stream")
async def stream_message(chat_id: str, req: MessageCreateRequest, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    """Stream the assistant's response token-by-token using Server-Sent Events."""
    # (1) Verify chat exists
    chat = sess.execute(
        text("SELECT id, title FROM chats WHERE id=:c AND user_id=:u"),
        {"c": chat_id, "u": x_user_id},
    ).mappings().first()
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Load conversation history (most recent 20 messages for context)
    history_rows = sess.execute(
        text("""SELECT role, content FROM messages
                WHERE chat_id=:c AND user_id=:u
                ORDER BY created_at DESC
                LIMIT 20"""),
        {"c": chat_id, "u": x_user_id},
    ).mappings().all()
    conversation_history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]

    # (2) Save the user message to DB
    mid_user = "m_" + uuid.uuid4().hex
    now = datetime.utcnow()
    sess.execute(
        text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                VALUES (:id, :chat, :user, :role, :content, :att, :created)"""),
        {
            "id": mid_user,
            "chat": chat_id,
            "user": user_id,
            "role": "user",
            "content": req.content,
            "att": json.dumps(req.attachment_ids),
            "created": now,
        },
    )
    sess.commit()

    # (3) Prepare attachments for AI
    attachment_blobs = []
    if req.attachment_ids:
        # Use IN clause with tuple for SQLite/PostgreSQL compatibility
        placeholders = ",".join([f":id{i}" for i in range(len(req.attachment_ids))])
        params = {"u": user_id}
        params.update({f"id{i}": aid for i, aid in enumerate(req.attachment_ids)})
        rows = sess.execute(
            text(f"SELECT id, filename, content_type, s3_key FROM files WHERE user_id=:u AND id IN ({placeholders})"),
            params,
        ).mappings().all()
        for r in rows:
            obj = s3.get_object(Bucket=S3_BUCKET, Key=r["s3_key"])
            raw = obj["Body"].read()
            attachment_blobs.append({
                "type": guess_attachment_type(r["content_type"]),
                "content_type": r["content_type"],
                "filename": r["filename"],
                "bytes_b64": base64.b64encode(raw).decode("utf-8"),
            })

    # (4) Build Claude API payload
    content_blocks = [{"type": "text", "text": req.content}]
    for att in attachment_blobs:
        if att["type"] == "image":
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": att["content_type"], "data": att["bytes_b64"]}
            })
        elif att["type"] == "document" and att["content_type"] == "application/pdf":
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": att["bytes_b64"]},
                "title": att.get("filename") or "document.pdf"
            })
        else:
            content_blocks.append({"type": "text", "text": f"[Stored attachment: {att.get('filename','file')} ({att['content_type']})]"})

    messages = []
    for msg in conversation_history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": content_blocks})

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1024,
        "stream": True,
        "system": SYSTEM_PROMPT,
        "messages": messages
    }

    # Store references for the generator closure
    user_id_ref = x_user_id
    chat_id_ref = chat_id
    is_first_message = len(conversation_history) == 0 and chat["title"] == "New Chat"
    user_content = req.content

    async def response_generator():
        full_response = ""
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json=payload,
                ) as response:
                    if response.status_code >= 400:
                        error_text = await response.aread()
                        yield f"data: {{\"error\": \"API error: {response.status_code}\"}}\n\n"
                        return

                    buffer = ""
                    async for chunk in response.aiter_text():
                        buffer += chunk
                        # Process complete SSE events from buffer
                        while "\n\n" in buffer:
                            event_end = buffer.index("\n\n")
                            event_data = buffer[:event_end]
                            buffer = buffer[event_end + 2:]

                            # Parse the SSE event
                            for line in event_data.split("\n"):
                                if line.startswith("data: "):
                                    json_str = line[6:]
                                    try:
                                        data = json.loads(json_str)
                                        event_type = data.get("type", "")

                                        if event_type == "content_block_delta":
                                            delta = data.get("delta", {})
                                            if delta.get("type") == "text_delta":
                                                text = delta.get("text", "")
                                                full_response += text
                                                # Escape for JSON and send
                                                escaped_text = json.dumps(text)[1:-1]  # Remove outer quotes
                                                yield f"data: {escaped_text}\n\n"

                                        elif event_type == "message_stop":
                                            pass  # Will be handled after loop

                                    except json.JSONDecodeError:
                                        pass  # Ignore malformed JSON

        except Exception as e:
            print(f"[Streaming Error] {e}")
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

        # Save assistant message to DB after streaming completes
        if full_response:
            try:
                with SessionLocal() as save_sess:
                    mid_assistant = "m_" + uuid.uuid4().hex
                    now2 = datetime.utcnow()
                    save_sess.execute(
                        text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                                VALUES (:id, :chat, :user, :role, :content, :att, :created)"""),
                        {
                            "id": mid_assistant,
                            "chat": chat_id_ref,
                            "user": user_id_ref,
                            "role": "assistant",
                            "content": full_response,
                            "att": json.dumps([]),
                            "created": now2,
                        },
                    )
                    save_sess.commit()

                    # Auto-generate title for new chats
                    if is_first_message:
                        try:
                            # Use synchronous httpx for title generation in this context
                            with httpx.Client(timeout=30) as title_client:
                                resp = title_client.post(
                                    "https://api.anthropic.com/v1/messages",
                                    headers={
                                        "x-api-key": ANTHROPIC_API_KEY,
                                        "anthropic-version": "2023-06-01",
                                        "content-type": "application/json",
                                    },
                                    json={
                                        "model": "claude-3-5-haiku-latest",
                                        "max_tokens": 20,
                                        "messages": [
                                            {
                                                "role": "user",
                                                "content": f"Generate a 2-4 word title for this conversation. Reply with ONLY the title, no quotes or punctuation.\n\nUser: {user_content[:200]}\nAssistant: {full_response[:200]}"
                                            }
                                        ],
                                    },
                                )
                                if resp.status_code == 200:
                                    data = resp.json()
                                    new_title = data["content"][0]["text"].strip().strip('"\'').title()
                                    if len(new_title) > 50:
                                        new_title = new_title[:47] + "..."
                                    save_sess.execute(
                                        text("UPDATE chats SET title=:t WHERE id=:c"),
                                        {"t": new_title, "c": chat_id_ref},
                                    )
                                    save_sess.commit()
                        except Exception as title_err:
                            print(f"[Title Generation Error] {title_err}")

            except Exception as save_err:
                print(f"[Save Message Error] {save_err}")

        yield "data: [DONE]\n\n"

    # (5) Return SSE streaming response
    return StreamingResponse(
        response_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

# ---------- App Library ----------
@app.post("/apps", response_model=AppResponse)
def create_app(req: AppCreateRequest, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    aid = "a_" + uuid.uuid4().hex
    now = datetime.utcnow()
    sess.execute(
        text("INSERT INTO apps (id, user_id, name, icon_emoji, launch_url, created_at) VALUES (:id,:u,:n,:i,:url,:t)"),
        {"id": aid, "u": x_user_id, "n": req.name, "i": req.icon_emoji, "url": req.launch_url, "t": now},
    )
    sess.commit()
    return {"id": aid, "name": req.name, "icon_emoji": req.icon_emoji, "launch_url": req.launch_url, "created_at": now}

@app.get("/apps", response_model=List[AppResponse])
def list_apps(sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    rows = sess.execute(
        text("SELECT id, name, icon_emoji, launch_url, created_at FROM apps WHERE user_id=:u ORDER BY created_at DESC"),
        {"u": user_id},
    ).mappings().all()
    return [dict(r) for r in rows]

@app.get("/apps/{app_id}/versions")
def list_app_versions(app_id: str, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    """List all versions of an app."""
    # Verify app ownership
    app_row = sess.execute(
        text("SELECT id FROM apps WHERE id=:a AND user_id=:u"),
        {"a": app_id, "u": x_user_id},
    ).first()
    if not app_row:
        raise HTTPException(404, "App not found")

    rows = sess.execute(
        text("SELECT id, prompt, created_at FROM app_versions WHERE app_id=:a AND user_id=:u ORDER BY created_at ASC"),
        {"a": app_id, "u": x_user_id},
    ).mappings().all()
    return [{"id": r["id"], "prompt": r["prompt"], "created_at": r["created_at"]} for r in rows]

APP_HTML_SHELL = """<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;">
  <title>Milio App</title>
  <style>
    body { font-family: system-ui; margin: 0; padding: 16px; }
    .milio-error {
      background: #fee;
      border: 1px solid #c33;
      border-radius: 8px;
      padding: 16px;
      margin: 20px 0;
      color: #900;
    }
    .milio-error h3 { margin: 0 0 8px 0; }
    .milio-error pre {
      background: #fff;
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
<div id="app"></div>
<script>
  // Minimal Milio SDK (MVP): send messages to React Native via postMessage
  window.Milio = {
    notify: (msg) => {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'notify', msg}));
      }
    },
    error: (err) => {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'error', message: err.message || String(err), stack: err.stack}));
      }
    }
  };

  // Global error handler
  window.onerror = function(message, source, lineno, colno, error) {
    console.error('App error:', message, source, lineno, colno, error);
    var errDiv = document.createElement('div');
    errDiv.className = 'milio-error';
    errDiv.innerHTML = '<h3>Something went wrong</h3>' +
      '<p>' + (message || 'Unknown error') + '</p>' +
      '<pre>' + (error && error.stack ? error.stack : 'No stack trace') + '</pre>';
    document.getElementById('app').innerHTML = '';
    document.getElementById('app').appendChild(errDiv);
    window.Milio.error(error || {message: message});
    return true; // Prevents default browser error handling
  };

  // Catch unhandled promise rejections
  window.onunhandledrejection = function(event) {
    console.error('Unhandled rejection:', event.reason);
    window.Milio.error(event.reason || {message: 'Unhandled promise rejection'});
  };
</script>
<script>
try {
__APP_JS__
} catch (e) {
  window.onerror(e.message, '', 0, 0, e);
}
</script>
</body>
</html>
"""

def clean_generated_js(js_code: str) -> str:
    """Clean up generated JavaScript code by removing markdown blocks and common issues."""
    import re

    code = js_code.strip()

    # Remove markdown code blocks (```javascript, ```js, ```)
    code = re.sub(r'^```(?:javascript|js)?\s*\n?', '', code, flags=re.MULTILINE)
    code = re.sub(r'\n?```\s*$', '', code, flags=re.MULTILINE)
    code = re.sub(r'```', '', code)

    # Remove any HTML comments that might cause issues
    code = re.sub(r'<!--.*?-->', '', code, flags=re.DOTALL)

    return code.strip()


async def claude_generate_app_js(prompt: str) -> str:
    if not ANTHROPIC_API_KEY:
        return "document.getElementById('app').innerText='Claude key not configured.';"

    system = (
        "You are generating a SINGLE-FILE web app that runs inside an existing HTML shell.\n"
        "CRITICAL: Return ONLY raw JavaScript code. NO markdown, NO code blocks, NO backticks.\n"
        "The code will be inserted directly into a <script> tag.\n"
        "Use document.getElementById('app') to mount your UI.\n"
        "No external network calls. No external libraries. Use plain DOM manipulation.\n"
        "Make it feel like a real app: header, navigation, basic state, and polished layout.\n"
        "Use template literals with backticks for HTML strings.\n"
    )

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 2000,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=payload,
        )
        if r.status_code >= 400:
            raise HTTPException(500, f"Claude error: {r.status_code} {r.text}")
        data = r.json()
        out = []
        for block in data.get("content", []):
            if block.get("type") == "text":
                out.append(block.get("text", ""))
        js = "\n".join(out).strip()

        # Clean up the generated code
        js = clean_generated_js(js)

        return js

@app.post("/apps/generate")
async def generate_app(req: AppGenerateRequest, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    # Verify app ownership
    row = sess.execute(
        text("SELECT id FROM apps WHERE id=:a AND user_id=:u"),
        {"a": req.app_id, "u": x_user_id},
    ).first()
    if not row:
        raise HTTPException(404, "App not found")

    js = await claude_generate_app_js(req.prompt)
    html = APP_HTML_SHELL.replace("__APP_JS__", js)

    vid = "v_" + uuid.uuid4().hex
    now = datetime.utcnow()
    s3_key = f"{user_id}/apps/{req.app_id}/{vid}/index.html"
    s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=html.encode("utf-8"), ContentType="text/html")

    sess.execute(
        text("""INSERT INTO app_versions (id, app_id, user_id, prompt, s3_key, created_at)
                VALUES (:id,:app_id,:u,:p,:s3,:t)"""),
        {"id": vid, "app_id": req.app_id, "u": x_user_id, "p": req.prompt, "s3": s3_key, "t": now},
    )
    sess.commit()

    return {"version_id": vid, "run_url": f"/apps/{req.app_id}/versions/{vid}/index.html"}

@app.get("/apps/{app_id}/versions/{version_id}/index.html")
def serve_app_html(app_id: str, version_id: str, sess=Depends(db), user_id: str = Depends(get_user_id_from_token)):
    row = sess.execute(
        text("""SELECT s3_key FROM app_versions
                WHERE id=:v AND app_id=:a AND user_id=:u"""),
        {"v": version_id, "a": app_id, "u": x_user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(404, "Version not found")
    obj = s3.get_object(Bucket=S3_BUCKET, Key=row["s3_key"])
    html = obj["Body"].read()
    return Response(content=html, media_type="text/html")

import os
import uuid
import json
from datetime import datetime, timedelta
from typing import Optional, List

from dotenv import load_dotenv
load_dotenv()

import boto3
import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

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

JWT_SECRET = os.environ.get("JWT_SECRET", "dev_secret_change_me")

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
from app.routes import stt
app.include_router(stt.router)

# ---------- DB bootstrap (MVP) ----------
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL
);

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

class AppResponse(BaseModel):
    id: str
    name: str
    icon_emoji: Optional[str]
    created_at: datetime

class AppGenerateRequest(BaseModel):
    app_id: str
    prompt: str

# ---------- Dev auth (MVP) ----------
from fastapi import Header

def get_user_id(x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Missing X-User-Id header")
    return x_user_id


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

# ---------- Chats ----------
@app.post("/chats", response_model=ChatResponse)
def create_chat(req: ChatCreateRequest, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
    chat_id = "c_" + uuid.uuid4().hex
    now = datetime.utcnow()
    sess.execute(
        text("INSERT INTO chats (id, user_id, title, created_at) VALUES (:id, :user_id, :title, :created_at)"),
        {"id": chat_id, "user_id": x_user_id, "title": req.title, "created_at": now},
    )
    sess.commit()
    return {"id": chat_id, "title": req.title, "created_at": now}

@app.get("/chats", response_model=List[ChatResponse])
def list_chats(sess=Depends(db), x_user_id: str = Depends(get_user_id)):
    rows = sess.execute(
        text("SELECT id, title, created_at FROM chats WHERE user_id=:u ORDER BY created_at DESC"),
        {"u": x_user_id},
    ).mappings().all()
    return [dict(r) for r in rows]

# ---------- File upload/store ----------
@app.post("/files/upload")
async def upload_file(
    chat_id: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    sess=Depends(db),
    x_user_id: str = Depends(get_user_id),
):
    fid = "f_" + uuid.uuid4().hex
    now = datetime.utcnow()

    content = await file.read()
    size_bytes = len(content)
    if size_bytes == 0:
        raise HTTPException(400, "Empty upload")

    s3_key = f"{x_user_id}/{fid}/{file.filename}"
    s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=content, ContentType=file.content_type or "application/octet-stream")

    sess.execute(
        text("""INSERT INTO files (id, user_id, chat_id, filename, content_type, size_bytes, s3_key, created_at)
                VALUES (:id, :user_id, :chat_id, :filename, :content_type, :size_bytes, :s3_key, :created_at)"""),
        {
            "id": fid,
            "user_id": x_user_id,
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
def download_file(file_id: str, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
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
        # Extract assistant text
        out = []
        for block in data.get("content", []):
            if block.get("type") == "text":
                out.append(block.get("text", ""))
        return "\n".join(out).strip() or "(No response)"

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
async def send_message(chat_id: str, req: MessageCreateRequest, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
    # verify chat and get current title
    chat = sess.execute(
        text("SELECT id, title FROM chats WHERE id=:c AND user_id=:u"),
        {"c": chat_id, "u": x_user_id},
    ).mappings().first()
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Load conversation history (last 20 messages for context)
    history_rows = sess.execute(
        text("""SELECT role, content FROM messages
                WHERE chat_id=:c AND user_id=:u
                ORDER BY created_at ASC
                LIMIT 20"""),
        {"c": chat_id, "u": x_user_id},
    ).mappings().all()

    conversation_history = [{"role": r["role"], "content": r["content"]} for r in history_rows]

    now = datetime.utcnow()
    mid_user = "m_" + uuid.uuid4().hex
    sess.execute(
        text("""INSERT INTO messages (id, chat_id, user_id, role, content, attachments_json, created_at)
                VALUES (:id,:chat_id,:user_id,:role,:content,:att,:created_at)"""),
        {
            "id": mid_user,
            "chat_id": chat_id,
            "user_id": x_user_id,
            "role": "user",
            "content": req.content,
            "att": json.dumps(req.attachment_ids),
            "created_at": now,
        },
    )

    # Load attachments bytes for Claude (only images + PDFs in MVP)
    attachment_blobs = []
    if req.attachment_ids:
        rows = sess.execute(
            text("SELECT id, filename, content_type, s3_key FROM files WHERE user_id=:u AND id = ANY(:ids)"),
            {"u": x_user_id, "ids": req.attachment_ids},
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
            "user_id": x_user_id,
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
def list_messages(chat_id: str, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
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

# ---------- App Library ----------
@app.post("/apps", response_model=AppResponse)
def create_app(req: AppCreateRequest, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
    aid = "a_" + uuid.uuid4().hex
    now = datetime.utcnow()
    sess.execute(
        text("INSERT INTO apps (id, user_id, name, icon_emoji, created_at) VALUES (:id,:u,:n,:i,:t)"),
        {"id": aid, "u": x_user_id, "n": req.name, "i": req.icon_emoji, "t": now},
    )
    sess.commit()
    return {"id": aid, "name": req.name, "icon_emoji": req.icon_emoji, "created_at": now}

@app.get("/apps", response_model=List[AppResponse])
def list_apps(sess=Depends(db), x_user_id: str = Depends(get_user_id)):
    rows = sess.execute(
        text("SELECT id, name, icon_emoji, created_at FROM apps WHERE user_id=:u ORDER BY created_at DESC"),
        {"u": x_user_id},
    ).mappings().all()
    return [dict(r) for r in rows]

APP_HTML_SHELL = """<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;">
  <title>Milio App</title>
  <style>body{font-family:system-ui;margin:0;padding:16px}</style>
</head>
<body>
<div id="app"></div>
<script>
  // Minimal Milio SDK (MVP): send messages to React Native via postMessage
  window.Milio = {
    notify: (msg) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'notify', msg}))
  };
</script>
<script>
__APP_JS__
</script>
</body>
</html>
"""

async def claude_generate_app_js(prompt: str) -> str:
    if not ANTHROPIC_API_KEY:
        return "document.getElementById('app').innerText='Claude key not configured.';"

    system = (
        "You are generating a SINGLE-FILE web app that runs inside an existing HTML shell.\n"
        "Return ONLY JavaScript (no markdown) that mounts UI into #app.\n"
        "No external network calls. No external libraries. Use plain DOM.\n"
        "Make it feel like a real app: header, navigation, basic state, and polished layout.\n"
    )

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1200,
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
        return js

@app.post("/apps/generate")
async def generate_app(req: AppGenerateRequest, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
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
    s3_key = f"{x_user_id}/apps/{req.app_id}/{vid}/index.html"
    s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=html.encode("utf-8"), ContentType="text/html")

    sess.execute(
        text("""INSERT INTO app_versions (id, app_id, user_id, prompt, s3_key, created_at)
                VALUES (:id,:app_id,:u,:p,:s3,:t)"""),
        {"id": vid, "app_id": req.app_id, "u": x_user_id, "p": req.prompt, "s3": s3_key, "t": now},
    )
    sess.commit()

    return {"version_id": vid, "run_url": f"/apps/{req.app_id}/versions/{vid}/index.html"}

@app.get("/apps/{app_id}/versions/{version_id}/index.html")
def serve_app_html(app_id: str, version_id: str, sess=Depends(db), x_user_id: str = Depends(get_user_id)):
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

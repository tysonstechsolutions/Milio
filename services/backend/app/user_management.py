"""User management for Milio backend."""

import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field

from app.auth import hash_password, verify_password
from app.logging_config import get_logger

logger = get_logger(__name__)

EMAIL_VERIFICATION_EXPIRES_HOURS = int(os.getenv("EMAIL_VERIFICATION_EXPIRES_HOURS", "24"))
PASSWORD_RESET_EXPIRES_HOURS = int(os.getenv("PASSWORD_RESET_EXPIRES_HOURS", "1"))
ACCOUNT_DELETION_DELAY_DAYS = int(os.getenv("ACCOUNT_DELETION_DELAY_DAYS", "30"))

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@milio.app")
APP_URL = os.getenv("APP_URL", "https://milio.app")


class VerifyEmailRequest(BaseModel):
    token: str

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8, max_length=128)

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)

class DeleteAccountRequest(BaseModel):
    password: str
    confirm: bool = Field(..., description="Must be true")


def generate_secure_token() -> str:
    return secrets.token_urlsafe(32)


async def send_email(to: str, subject: str, html_body: str, text_body: str = None) -> bool:
    if not SMTP_HOST:
        logger.warning("Email not configured", to=to)
        return False
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = FROM_EMAIL
        msg["To"] = to
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            if SMTP_USER and SMTP_PASSWORD:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(FROM_EMAIL, to, msg.as_string())
        return True
    except Exception as e:
        logger.error("Failed to send email", error=str(e))
        return False


async def send_verification_email(sess: Session, user_id: str, email: str) -> bool:
    token = generate_secure_token()
    sess.execute(
        text("UPDATE users SET email_verification_token=:t, email_verification_sent_at=:s WHERE id=:u"),
        {"t": token, "s": datetime.utcnow(), "u": user_id}
    )
    sess.commit()
    url = f"{APP_URL}/verify-email?token={token}"
    html = f"<h1>Verify Email</h1><p><a href='{url}'>Verify</a></p>"
    return await send_email(email, "Verify your Milio account", html)


def verify_email_token(sess: Session, token: str) -> dict:
    row = sess.execute(
        text("SELECT id, email, email_verified FROM users WHERE email_verification_token=:t"),
        {"t": token}
    ).mappings().first()
    if not row:
        raise HTTPException(400, "Invalid token")
    if row["email_verified"]:
        raise HTTPException(400, "Already verified")
    sess.execute(text("UPDATE users SET email_verified=true, email_verification_token=NULL WHERE id=:i"), {"i": row["id"]})
    sess.commit()
    return {"id": row["id"], "email": row["email"]}


async def send_password_reset_email(sess: Session, email: str) -> bool:
    row = sess.execute(text("SELECT id FROM users WHERE email=:e"), {"e": email.lower()}).mappings().first()
    if not row:
        return True
    token = generate_secure_token()
    expires = datetime.utcnow() + timedelta(hours=PASSWORD_RESET_EXPIRES_HOURS)
    sess.execute(
        text("UPDATE users SET password_reset_token=:t, password_reset_expires_at=:e WHERE id=:i"),
        {"t": token, "e": expires, "i": row["id"]}
    )
    sess.commit()
    url = f"{APP_URL}/reset-password?token={token}"
    html = f"<h1>Reset Password</h1><p><a href='{url}'>Reset</a></p>"
    await send_email(email, "Reset your Milio password", html)
    return True


def reset_password_with_token(sess: Session, token: str, new_password: str) -> dict:
    row = sess.execute(
        text("SELECT id, email, password_reset_expires_at FROM users WHERE password_reset_token=:t"),
        {"t": token}
    ).mappings().first()
    if not row:
        raise HTTPException(400, "Invalid token")
    if row["password_reset_expires_at"] and datetime.utcnow() > row["password_reset_expires_at"]:
        raise HTTPException(400, "Token expired")
    ph = hash_password(new_password)
    sess.execute(text("UPDATE users SET password_hash=:h, password_reset_token=NULL, password_reset_expires_at=NULL WHERE id=:i"), {"h": ph, "i": row["id"]})
    sess.commit()
    return {"id": row["id"], "email": row["email"]}


def change_password(sess: Session, user_id: str, current_password: str, new_password: str) -> bool:
    row = sess.execute(text("SELECT password_hash FROM users WHERE id=:i"), {"i": user_id}).mappings().first()
    if not row:
        raise HTTPException(404, "User not found")
    if not verify_password(current_password, row["password_hash"]):
        raise HTTPException(400, "Wrong password")
    sess.execute(text("UPDATE users SET password_hash=:h WHERE id=:i"), {"h": hash_password(new_password), "i": user_id})
    sess.commit()
    return True


def request_account_deletion(sess: Session, user_id: str, password: str) -> dict:
    row = sess.execute(text("SELECT password_hash FROM users WHERE id=:i"), {"i": user_id}).mappings().first()
    if not row:
        raise HTTPException(404, "User not found")
    if not verify_password(password, row["password_hash"]):
        raise HTTPException(400, "Wrong password")
    deletion_date = datetime.utcnow() + timedelta(days=ACCOUNT_DELETION_DELAY_DAYS)
    sess.execute(text("UPDATE users SET deletion_requested_at=:r, deleted_at=:d WHERE id=:i"), {"r": datetime.utcnow(), "d": deletion_date, "i": user_id})
    sess.commit()
    return {"message": f"Deletion scheduled for {deletion_date.date()}", "deletion_date": deletion_date.isoformat()}


def cancel_account_deletion(sess: Session, user_id: str) -> bool:
    sess.execute(text("UPDATE users SET deletion_requested_at=NULL, deleted_at=NULL WHERE id=:i"), {"i": user_id})
    sess.commit()
    return True

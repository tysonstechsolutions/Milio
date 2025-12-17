"""Cleanup and maintenance jobs for Milio backend."""

import os
from datetime import datetime, timedelta
from typing import Dict, Any

import boto3
from sqlalchemy import text, create_engine
from sqlalchemy.orm import sessionmaker

from app.logging_config import get_logger

logger = get_logger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")
S3_BUCKET = os.environ.get("S3_BUCKET", "milio")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")

ORPHAN_FILE_AGE_HOURS = int(os.getenv("ORPHAN_FILE_AGE_HOURS", "24"))
UNVERIFIED_ACCOUNT_AGE_DAYS = int(os.getenv("UNVERIFIED_ACCOUNT_AGE_DAYS", "7"))
OLD_APP_VERSION_KEEP_COUNT = int(os.getenv("OLD_APP_VERSION_KEEP_COUNT", "5"))


def get_session():
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    return Session()


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
    )


def cleanup_orphaned_files() -> Dict[str, Any]:
    sess = get_session()
    s3 = get_s3()
    deleted = 0
    
    try:
        cutoff = datetime.utcnow() - timedelta(hours=ORPHAN_FILE_AGE_HOURS)
        orphaned = sess.execute(
            text("""
                SELECT f.id, f.s3_key, f.size_bytes
                FROM files f
                WHERE f.created_at < :cutoff
                  AND f.chat_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM messages m 
                    WHERE m.chat_id = f.chat_id 
                      AND m.attachments_json LIKE '%' || f.id || '%'
                  )
            """),
            {"cutoff": cutoff}
        ).mappings().all()
        
        for f in orphaned:
            try:
                s3.delete_object(Bucket=S3_BUCKET, Key=f["s3_key"])
                sess.execute(text("DELETE FROM files WHERE id=:i"), {"i": f["id"]})
                deleted += 1
            except Exception as e:
                logger.warning(f"Failed to delete file: {e}")
        
        sess.commit()
    finally:
        sess.close()
    
    return {"deleted_files": deleted}


def cleanup_deleted_accounts() -> Dict[str, Any]:
    sess = get_session()
    s3 = get_s3()
    deleted = 0
    
    try:
        accounts = sess.execute(
            text("SELECT id, email FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= :now"),
            {"now": datetime.utcnow()}
        ).mappings().all()
        
        for acc in accounts:
            uid = acc["id"]
            
            # Delete S3 files
            files = sess.execute(text("SELECT s3_key FROM files WHERE user_id=:u"), {"u": uid}).mappings().all()
            for f in files:
                try:
                    s3.delete_object(Bucket=S3_BUCKET, Key=f["s3_key"])
                except: pass
            
            # Delete app versions from S3
            versions = sess.execute(text("SELECT s3_key FROM app_versions WHERE user_id=:u"), {"u": uid}).mappings().all()
            for v in versions:
                try:
                    s3.delete_object(Bucket=S3_BUCKET, Key=v["s3_key"])
                except: pass
            
            # Delete DB records
            sess.execute(text("DELETE FROM messages WHERE user_id=:u"), {"u": uid})
            sess.execute(text("DELETE FROM files WHERE user_id=:u"), {"u": uid})
            sess.execute(text("DELETE FROM app_versions WHERE user_id=:u"), {"u": uid})
            sess.execute(text("DELETE FROM apps WHERE user_id=:u"), {"u": uid})
            sess.execute(text("DELETE FROM chats WHERE user_id=:u"), {"u": uid})
            sess.execute(text("DELETE FROM users WHERE id=:u"), {"u": uid})
            deleted += 1
        
        sess.commit()
    finally:
        sess.close()
    
    return {"deleted_accounts": deleted}


def cleanup_unverified_accounts() -> Dict[str, Any]:
    sess = get_session()
    deleted = 0
    
    try:
        cutoff = datetime.utcnow() - timedelta(days=UNVERIFIED_ACCOUNT_AGE_DAYS)
        accounts = sess.execute(
            text("""
                SELECT u.id FROM users u
                WHERE u.email_verified = false
                  AND u.created_at < :cutoff
                  AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.user_id = u.id)
            """),
            {"cutoff": cutoff}
        ).mappings().all()
        
        for acc in accounts:
            sess.execute(text("DELETE FROM users WHERE id=:i"), {"i": acc["id"]})
            deleted += 1
        
        sess.commit()
    finally:
        sess.close()
    
    return {"deleted_accounts": deleted}


def cleanup_old_app_versions() -> Dict[str, Any]:
    sess = get_session()
    s3 = get_s3()
    deleted = 0
    
    try:
        apps = sess.execute(
            text("SELECT app_id, COUNT(*) as cnt FROM app_versions GROUP BY app_id HAVING COUNT(*) > :k"),
            {"k": OLD_APP_VERSION_KEEP_COUNT}
        ).mappings().all()
        
        for app in apps:
            old = sess.execute(
                text("SELECT id, s3_key FROM app_versions WHERE app_id=:a ORDER BY created_at DESC OFFSET :o"),
                {"a": app["app_id"], "o": OLD_APP_VERSION_KEEP_COUNT}
            ).mappings().all()
            
            for v in old:
                try:
                    s3.delete_object(Bucket=S3_BUCKET, Key=v["s3_key"])
                    sess.execute(text("DELETE FROM app_versions WHERE id=:i"), {"i": v["id"]})
                    deleted += 1
                except: pass
        
        sess.commit()
    finally:
        sess.close()
    
    return {"deleted_versions": deleted}


def run_all_cleanup_jobs() -> Dict[str, Any]:
    logger.info("Starting cleanup jobs")
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "orphaned_files": cleanup_orphaned_files(),
        "deleted_accounts": cleanup_deleted_accounts(),
        "unverified_accounts": cleanup_unverified_accounts(),
        "old_app_versions": cleanup_old_app_versions(),
    }


if __name__ == "__main__":
    import sys
    import json
    
    jobs = {
        "orphaned-files": cleanup_orphaned_files,
        "deleted-accounts": cleanup_deleted_accounts,
        "unverified-accounts": cleanup_unverified_accounts,
        "old-app-versions": cleanup_old_app_versions,
        "all": run_all_cleanup_jobs,
    }
    
    job = sys.argv[1] if len(sys.argv) > 1 else "all"
    if job in jobs:
        result = jobs[job]()
        print(json.dumps(result, indent=2, default=str))
    else:
        print(f"Unknown job. Available: {list(jobs.keys())}")

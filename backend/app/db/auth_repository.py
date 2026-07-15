"""
360SCOUT — Auth Repository
משתמשים, סשנים והרשאות. אותו דפוס graceful degradation כמו repository.py —
כל פונקציה מחזירה None/False/[] אם ה-DB לא זמין, לעולם לא זורקת החוצה.
"""

import os
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt

from .database import get_db

logger = logging.getLogger(__name__)

SESSION_ABSOLUTE_HOURS = int(os.getenv("SESSION_ABSOLUTE_HOURS", "24"))
MAX_PASSWORD_BYTES = 72  # bcrypt hard limit


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(plain: str) -> str:
    encoded = plain.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError("Password too long")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ────────────────────────────────────────────────────────────────────────────
# משתמשים
# ────────────────────────────────────────────────────────────────────────────

async def create_user(email: str, password: str) -> Optional[str]:
    """יוצר משתמש status='pending'. מחזיר None אם כבר קיים אימייל זהה או אם ה-DB לא זמין."""
    pool = await get_db()
    if pool is None:
        return None
    try:
        password_hash = hash_password(password)
    except ValueError:
        return None
    try:
        async with pool.acquire() as conn:
            user_id = await conn.fetchval(
                """
                INSERT INTO users (email, password_hash)
                VALUES ($1, $2)
                ON CONFLICT (email) DO NOTHING
                RETURNING id
                """,
                _normalize_email(email), password_hash,
            )
        return str(user_id) if user_id else None
    except Exception as e:
        logger.error(f"create_user failed: {e}")
        return None


async def get_user_by_email(email: str) -> Optional[dict]:
    pool = await get_db()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, email, password_hash, role, status, created_at, approved_at, approved_by
                FROM users WHERE email = $1
                """,
                _normalize_email(email),
            )
        return dict(row) if row else None
    except Exception as e:
        logger.error(f"get_user_by_email failed: {e}")
        return None


async def get_user_by_id(user_id: str) -> Optional[dict]:
    pool = await get_db()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, email, role, status, created_at, approved_at, approved_by
                FROM users WHERE id = $1::uuid
                """,
                user_id,
            )
        return dict(row) if row else None
    except Exception as e:
        logger.error(f"get_user_by_id failed: {e}")
        return None


async def approve_user(user_id: str, approved_by: str) -> bool:
    pool = await get_db()
    if pool is None:
        return False
    try:
        async with pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE users
                SET status = 'approved', approved_at = NOW(), approved_by = $2::uuid
                WHERE id = $1::uuid
                """,
                user_id, approved_by,
            )
        return result == "UPDATE 1"
    except Exception as e:
        logger.error(f"approve_user failed: {e}")
        return False


async def reject_user(user_id: str) -> bool:
    """דוחה משתמש ומוחק את הסשנים שלו מיידית — לא מחכה ל-idle timeout."""
    pool = await get_db()
    if pool is None:
        return False
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                result = await conn.execute(
                    "UPDATE users SET status = 'rejected' WHERE id = $1::uuid",
                    user_id,
                )
                await conn.execute(
                    "DELETE FROM sessions WHERE user_id = $1::uuid",
                    user_id,
                )
        return result == "UPDATE 1"
    except Exception as e:
        logger.error(f"reject_user failed: {e}")
        return False


async def list_users_by_status(status: str, limit: int = 200) -> list:
    pool = await get_db()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, email, role, status, created_at, approved_at, approved_by
                FROM users WHERE status = $1
                ORDER BY created_at DESC
                LIMIT $2
                """,
                status, limit,
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"list_users_by_status failed: {e}")
        return []


# ────────────────────────────────────────────────────────────────────────────
# סשנים
# ────────────────────────────────────────────────────────────────────────────

async def create_session(user_id: str) -> Optional[str]:
    pool = await get_db()
    if pool is None:
        return None
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=SESSION_ABSOLUTE_HOURS)
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2::uuid, $3)",
                token, user_id, expires_at,
            )
        return token
    except Exception as e:
        logger.error(f"create_session failed: {e}")
        return None


async def get_session_with_user(token: str) -> Optional[dict]:
    pool = await get_db()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT s.token, s.user_id, s.last_seen_at, s.expires_at,
                       u.email, u.role, u.status
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = $1
                """,
                token,
            )
        return dict(row) if row else None
    except Exception as e:
        logger.error(f"get_session_with_user failed: {e}")
        return None


async def touch_session(token: str) -> None:
    """Throttled — no-op if last touched under 30s ago, so an active session doesn't write every request."""
    pool = await get_db()
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE sessions SET last_seen_at = NOW()
                WHERE token = $1 AND last_seen_at < NOW() - INTERVAL '30 seconds'
                """,
                token,
            )
    except Exception as e:
        logger.debug(f"touch_session failed: {e}")


async def delete_session(token: str) -> None:
    pool = await get_db()
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM sessions WHERE token = $1", token)
    except Exception as e:
        logger.debug(f"delete_session failed: {e}")


# ────────────────────────────────────────────────────────────────────────────
# Admin seed — נקרא פעם אחת מ-startup
# ────────────────────────────────────────────────────────────────────────────

async def seed_admin_user() -> None:
    """
    יוצר את חשבון האדמין הראשון מ-ADMIN_EMAIL/ADMIN_PASSWORD (env).
    Idempotent — אם כבר קיים משתמש עם אותו אימייל, לא נוגע בו (לא דורס סיסמה שהוחלפה).
    לעולם לא מדפיס את הסיסמה בטקסט גלוי.
    """
    email = os.getenv("ADMIN_EMAIL", "").strip()
    password = os.getenv("ADMIN_PASSWORD", "")
    if not email or not password:
        logger.warning("ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed")
        return

    if await get_user_by_email(email):
        logger.info(f"Admin already seeded, skipping: {_normalize_email(email)}")
        return

    pool = await get_db()
    if pool is None:
        logger.warning("DB unavailable — cannot seed admin user")
        return

    try:
        password_hash = hash_password(password)
    except ValueError:
        logger.error("ADMIN_PASSWORD exceeds bcrypt's 72-byte limit — skipping admin seed")
        return

    email_norm = _normalize_email(email)
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO users (email, password_hash, role, status, approved_at)
                VALUES ($1, $2, 'admin', 'approved', NOW())
                ON CONFLICT (email) DO NOTHING
                """,
                email_norm, password_hash,
            )
        logger.info(f"Seeded admin user: {email_norm}")
    except Exception as e:
        logger.error(f"seed_admin_user failed: {e}")

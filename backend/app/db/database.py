"""
360SCOUT — Database Layer
Async connection pool via asyncpg (ללא SQLAlchemy ORM — שאילתות SQL ישירות).
"""

import os
import logging
import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Pool singleton ──────────────────────────────────────────────────────────
_pool: asyncpg.Pool | None = None


def _build_dsn() -> str:
    """המר DATABASE_URL מ-SQLAlchemy format ל-asyncpg format"""
    url = os.getenv("DATABASE_URL", "")
    # מסיר את "postgresql+asyncpg://" ומחזיר "postgresql://..."
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def init_db() -> None:
    """אתחל את ה-connection pool — נקרא מ-startup של FastAPI"""
    global _pool
    if _pool is not None:
        return
    dsn = _build_dsn()
    try:
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        logger.info("DB pool initialized (min=2 max=10)")
    except Exception as e:
        logger.error(f"DB init failed: {e}")
        _pool = None


async def close_db() -> None:
    """סגור את ה-pool — נקרא מ-shutdown של FastAPI"""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("DB pool closed")


async def get_db() -> asyncpg.Pool | None:
    """החזר את ה-pool (None אם חיבור נכשל — האפליקציה ממשיכה ללא DB)"""
    if _pool is None:
        await init_db()
    return _pool

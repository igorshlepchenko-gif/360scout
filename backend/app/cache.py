"""
360SCOUT — Cache Layer (PostgreSQL-backed)
שומר cache ב-DB כדי לשרוד deployments ו-Railway restarts.
Fallback לקבצים אם ה-DB לא זמין.
"""

import os
import json
import time
import hashlib
import logging
from pathlib import Path
from typing import Any, Optional
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

CACHE_MINUTES = int(os.getenv("API_FOOTBALL_CACHE_MINUTES", "60"))
CACHE_DIR     = Path(__file__).parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

TTL_MAP = {
    "live":     2   * 60,
    "fixtures": 360 * 60,
    "odds":     60  * 60,
    "weather":  30  * 60,
    "stats":    360 * 60,
    "injuries": 10  * 60,
}

# ─── helpers ────────────────────────────────────────────────────────────────

def _hkey(key: str) -> str:
    return hashlib.md5(key.encode()).hexdigest()

def _file_path(key: str) -> Path:
    return CACHE_DIR / f"{_hkey(key)}.json"

# ─── file fallback (sync) ────────────────────────────────────────────────────

def _file_get(key: str, cache_type: str) -> Optional[Any]:
    path = _file_path(key)
    # No exists() check — avoids TOCTOU race between check and read.
    # FileNotFoundError and JSONDecodeError are clean misses; other exceptions
    # indicate a corrupted file that should be deleted.
    try:
        entry = json.loads(path.read_text(encoding="utf-8"))
        ttl   = TTL_MAP.get(cache_type, CACHE_MINUTES * 60)
        if time.time() - entry.get("timestamp", 0) > ttl:
            path.unlink(missing_ok=True)
            return None
        return entry["data"]
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    except Exception:
        path.unlink(missing_ok=True)
        return None


def _file_set(key: str, data: Any, cache_type: str) -> None:
    try:
        _file_path(key).write_text(
            json.dumps({"key": key[:100], "type": cache_type,
                        "timestamp": time.time(), "data": data},
                       ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8"
        )
    except Exception as e:
        logger.warning(f"File cache write error: {e}")


# ─── async DB cache ──────────────────────────────────────────────────────────

async def _db_get(key: str, cache_type: str) -> Optional[Any]:
    try:
        from app.db.database import get_db
        pool = await get_db()
        if pool is None:
            return None
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT data, expires_at FROM api_cache WHERE key = $1", key
            )
        if not row:
            return None
        import datetime
        if row["expires_at"] < datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc):
            return None
        try:
            return json.loads(row["data"])
        except json.JSONDecodeError as e:
            logger.warning(f"DB cache corrupted entry for key={key[:50]}: {e}")
            return None
    except Exception as e:
        logger.debug(f"DB cache get error: {e}")
        return None


async def _db_set(key: str, data: Any, cache_type: str) -> None:
    try:
        from app.db.database import get_db
        import datetime
        pool = await get_db()
        if pool is None:
            return
        ttl     = TTL_MAP.get(cache_type, CACHE_MINUTES * 60)
        expires = datetime.datetime.utcnow().replace(
            tzinfo=datetime.timezone.utc
        ) + datetime.timedelta(seconds=ttl)
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO api_cache (key, cache_type, data, expires_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (key) DO UPDATE
                    SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at,
                        cache_type = EXCLUDED.cache_type
            """, key, cache_type, json.dumps(data, ensure_ascii=False), expires)
    except Exception as e:
        logger.debug(f"DB cache set error: {e}")


# ─── public async API ────────────────────────────────────────────────────────

async def get(key: str, cache_type: str = "fixtures") -> Optional[Any]:
    """קרא מ-cache — DB קודם, אחר כך קבצים"""
    result = await _db_get(key, cache_type)
    if result is not None:
        logger.info(f"Cache HIT (DB): {cache_type} | {key[:50]}")
        return result

    result = _file_get(key, cache_type)
    if result is not None:
        logger.info(f"Cache HIT (file): {cache_type} | {key[:50]}")
    return result


async def set(key: str, data: Any, cache_type: str = "fixtures") -> None:
    """שמור ב-cache — DB + קבצים"""
    await _db_set(key, data, cache_type)
    _file_set(key, data, cache_type)
    ttl = TTL_MAP.get(cache_type, CACHE_MINUTES * 60)
    logger.info(f"Cache SET: {cache_type} | {key[:50]} | TTL {ttl//60}m")


async def clear_all() -> int:
    """מחק את כל ה-cache"""
    count = 0
    for f in CACHE_DIR.glob("*.json"):
        f.unlink()
        count += 1
    try:
        from app.db.database import get_db
        pool = await get_db()
        if pool:
            async with pool.acquire() as conn:
                deleted = await conn.fetchval("DELETE FROM api_cache RETURNING count(*)")
                count += deleted or 0
    except Exception:
        pass
    logger.info(f"Cache cleared: {count} entries")
    return count


async def stats() -> dict:
    """סטטיסטיקות cache"""
    files = list(CACHE_DIR.glob("*.json"))
    db_count = 0
    try:
        from app.db.database import get_db
        pool = await get_db()
        if pool:
            async with pool.acquire() as conn:
                db_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM api_cache WHERE expires_at > NOW()"
                ) or 0
    except Exception:
        pass
    return {
        "file_entries": len(files),
        "db_entries":   db_count,
        "ttl_minutes":  CACHE_MINUTES,
    }

"""
360SCOUT — Cache Layer
מטמון חכם שמונע קריאות API כפולות.
עובד עם קבצי JSON על הדיסק (אין צורך ב-Redis).
TTL נקבע לפי API_FOOTBALL_CACHE_MINUTES מה-.env
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

# ===== הגדרות =====
CACHE_MINUTES  = int(os.getenv("API_FOOTBALL_CACHE_MINUTES", "60"))
CACHE_DIR      = Path(__file__).parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

# TTL שונה לפי סוג נתון
TTL_MAP = {
    "live":      2 * 60,                      # משחקים חיים — 2 דקות
    "fixtures":  360 * 60,                     # משחקים — 6 שעות (חוסך קריאות API)
    "odds":      60 * 60,                      # יחסים — 60 דקות (חוסך ~80 קריאות/יום)
    "weather":   30 * 60,                      # מזג אוויר — 30 דקות
    "stats":     360 * 60,                     # סטטיסטיקות קבוצות — 6 שעות (חוסך קריאות API)
    "injuries":  10 * 60,                      # פציעות — 10 דקות
}


def _cache_path(key: str) -> Path:
    """נתיב קובץ cache לפי hash של המפתח"""
    h = hashlib.md5(key.encode()).hexdigest()
    return CACHE_DIR / f"{h}.json"


def get(key: str, cache_type: str = "fixtures") -> Optional[Any]:
    """
    קרא מה-cache.
    מחזיר None אם פג תוקף או לא קיים.
    """
    path = _cache_path(key)
    if not path.exists():
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            entry = json.load(f)

        ttl = TTL_MAP.get(cache_type, CACHE_MINUTES * 60)
        age = time.time() - entry.get("timestamp", 0)

        if age > ttl:
            path.unlink(missing_ok=True)  # מחק cache ישן
            logger.debug(f"Cache expired: {key[:50]} (age={age:.0f}s, ttl={ttl}s)")
            return None

        logger.info(f"Cache HIT: {cache_type} | {key[:60]} | עוד {(ttl - age) / 60:.1f} דקות")
        return entry["data"]

    except Exception as e:
        logger.warning(f"Cache read error: {e}")
        path.unlink(missing_ok=True)
        return None


def set(key: str, data: Any, cache_type: str = "fixtures") -> None:
    """שמור ב-cache"""
    path = _cache_path(key)
    try:
        entry = {
            "key":       key[:100],
            "type":      cache_type,
            "timestamp": time.time(),
            "data":      data,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entry, f, ensure_ascii=False, separators=(",", ":"))

        ttl = TTL_MAP.get(cache_type, CACHE_MINUTES * 60)
        logger.info(f"Cache SET: {cache_type} | {key[:60]} | תוקף {ttl / 60:.0f} דקות")
    except Exception as e:
        logger.warning(f"Cache write error: {e}")


def invalidate(key: str) -> None:
    """מחק entry ספציפי מה-cache"""
    _cache_path(key).unlink(missing_ok=True)


def clear_all() -> int:
    """מחק את כל ה-cache — מחזיר כמות קבצים שנמחקו"""
    count = 0
    for f in CACHE_DIR.glob("*.json"):
        f.unlink()
        count += 1
    logger.info(f"Cache cleared: {count} files")
    return count


def stats() -> dict:
    """סטטיסטיקות על ה-cache הנוכחי"""
    files    = list(CACHE_DIR.glob("*.json"))
    valid    = 0
    expired  = 0
    by_type: dict[str, int] = {}

    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as fp:
                entry = json.load(fp)
            ctype = entry.get("type", "unknown")
            ttl   = TTL_MAP.get(ctype, CACHE_MINUTES * 60)
            age   = time.time() - entry.get("timestamp", 0)

            if age <= ttl:
                valid += 1
                by_type[ctype] = by_type.get(ctype, 0) + 1
            else:
                expired += 1
        except Exception:
            expired += 1

    total_size = sum(f.stat().st_size for f in files)
    return {
        "total_files":  len(files),
        "valid":        valid,
        "expired":      expired,
        "by_type":      by_type,
        "size_kb":      round(total_size / 1024, 1),
        "cache_dir":    str(CACHE_DIR),
        "ttl_minutes":  CACHE_MINUTES,
    }

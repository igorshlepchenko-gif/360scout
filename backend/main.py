"""
360SCOUT — FastAPI Application Entry Point
Run: python main.py  (or: uvicorn main:app --reload)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.matches import router as matches_router
from app.api.routes.live import router as live_router
from app.api.routes.analysts import router as analysts_router
from app.telegram_bot import test_bot, send_message, ENABLED as TELEGRAM_ENABLED
from app.db.database import init_db, close_db
from app.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """אתחול ב-startup וניקוי ב-shutdown"""
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()
    await close_db()


app = FastAPI(
    title       = "360SCOUT — Sports Prediction API",
    description = "360-Degree cross-referencing predictive model for football.",
    version     = "1.0.0",
    lifespan    = lifespan,
)

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://analyst365.net",
    "https://www.analyst365.net",
    "https://360scout.vercel.app",
    os.getenv("FRONTEND_URL", ""),
    os.getenv("VERCEL_URL", ""),
]
ALLOWED_ORIGINS = [o for o in ALLOWED_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ALLOWED_ORIGINS,
    allow_origin_regex= r"https://.*\.vercel\.app",
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

app.include_router(matches_router)
app.include_router(live_router)
app.include_router(analysts_router)


@app.get("/")
async def root():
    return {
        "name":    "360SCOUT API",
        "version": "1.0.0",
        "status":  "running",
        "docs":    "/docs",
        "demo":    "/api/matches/demo",
    }


@app.get("/api/db-status")
async def db_status():
    """בדוק אילו טבלאות קיימות ב-DB"""
    from app.db.database import get_db
    pool = await get_db()
    if pool is None:
        return {"connected": False, "error": "no pool"}
    try:
        async with pool.acquire() as conn:
            tables = await conn.fetch("""
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
            """)
            count = await conn.fetchval("SELECT COUNT(*) FROM match_predictions") if any(t["tablename"] == "match_predictions" for t in tables) else -1
            return {
                "connected": True,
                "tables": [t["tablename"] for t in tables],
                "predictions_count": count,
            }
    except Exception as e:
        return {"connected": True, "error": str(e)}


@app.get("/health")
async def health():
    from app.scheduler import _scheduler
    jobs = []
    if _scheduler:
        jobs = [
            {"id": j.id, "next_run": str(j.next_run_time)}
            for j in _scheduler.get_jobs()
        ]
    return {"status": "ok", "scheduler": "running" if _scheduler else "off", "jobs": jobs}




@app.get("/api/telegram/test")
async def telegram_test():
    """בדוק חיבור Telegram"""
    result = await test_bot()
    return result


@app.post("/api/telegram/send")
async def telegram_send(message: str):
    """שלח הודעה ידנית לערוץ"""
    ok = await send_message(message)
    return {"sent": ok, "telegram_enabled": TELEGRAM_ENABLED}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    reload = os.getenv("APP_ENV", "development") == "development"
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)

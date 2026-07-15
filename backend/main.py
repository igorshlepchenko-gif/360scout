"""
360SCOUT — FastAPI Application Entry Point
Run: python main.py  (or: uvicorn main:app --reload)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from contextlib import asynccontextmanager
import fastapi
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.matches import router as matches_router
from app.api.routes.live import router as live_router
from app.api.routes.analysts import router as analysts_router
from app.api.routes.signals import router as signals_router
from app.api.routes.auth import router as auth_router
from app.api.routes.admin import router as admin_router
from app.api.deps import get_current_user
from app.telegram_bot import test_bot, send_message, ENABLED as TELEGRAM_ENABLED
from app.db.database import init_db, close_db
from app.db.auth_repository import seed_admin_user
from app.scheduler import start_scheduler, stop_scheduler
from app.telegram_commands import start_command_bot, stop_command_bot


@asynccontextmanager
async def lifespan(app: FastAPI):
    """אתחול ב-startup וניקוי ב-shutdown"""
    async def _startup_db():
        await init_db()
        await seed_admin_user()
    asyncio.create_task(_startup_db())  # non-blocking so healthcheck passes immediately
    start_scheduler()
    start_command_bot()
    yield
    stop_command_bot()
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
app.include_router(signals_router)
app.include_router(auth_router)
app.include_router(admin_router)


@app.get("/")
async def root():
    return {
        "name":     "360SCOUT API",
        "version":  "1.0.0",
        "status":   "running",
        "docs":     "/docs",
        "register": "/api/auth/register",
    }


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




@app.get("/api/telegram/test", dependencies=[fastapi.Depends(get_current_user)])
async def telegram_test():
    """בדוק חיבור Telegram"""
    result = await test_bot()
    return result


@app.post("/api/telegram/send")
async def telegram_send(message: str, x_scout_token: str = fastapi.Header(default="")):
    """שלח הודעה ידנית לערוץ — requires X-Scout-Token header"""
    expected = os.getenv("SCOUT_API_TOKEN", "")
    if not expected or x_scout_token != expected:
        raise fastapi.HTTPException(status_code=401, detail="Unauthorized")
    if len(message) > 4000:
        message = message[:4000]
    ok = await send_message(message)
    return {"sent": ok, "telegram_enabled": TELEGRAM_ENABLED}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    reload = os.getenv("APP_ENV", "development") == "development"
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """אתחול ב-startup וניקוי ב-shutdown"""
    await init_db()
    yield
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


@app.get("/health")
async def health():
    return {"status": "ok"}


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

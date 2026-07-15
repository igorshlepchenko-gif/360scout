"""
360SCOUT — Auth Routes
register/login/logout/me. login מיישם rate-limit (5 נסיונות כושלים / 15 דקות לפי אימייל,
דרך app.cache הקיים) והודעות שגיאה בטוחות מפני enumeration: אימייל לא קיים וסיסמה שגויה
מחזירים בדיוק אותה הודעה; pending/rejected נחשפים רק אחרי סיסמה נכונה.
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.db.auth_repository import (
    get_user_by_email, create_user, verify_password, create_session, delete_session,
)
from app.api.deps import get_current_user, bearer_scheme
from app.cache import get as cache_get, set as cache_set

router = APIRouter(prefix="/api/auth", tags=["auth"])

RATE_LIMIT_MAX_ATTEMPTS = 5
RATE_LIMIT_KEY_PREFIX = "auth:login_attempts:"


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: str
    password: str


def _valid_email(email: str) -> bool:
    email = email.strip()
    if not (3 <= len(email) <= 255) or email.count("@") != 1:
        return False
    local, _, domain = email.partition("@")
    return bool(local) and "." in domain and not domain.startswith(".") and not domain.endswith(".")


@router.post("/register", status_code=201)
async def register(req: RegisterRequest):
    if not _valid_email(req.email):
        raise HTTPException(status_code=422, detail="Invalid email address")

    if await get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    user_id = await create_user(req.email, req.password)
    if not user_id:
        raise HTTPException(status_code=500, detail="Could not create account — please try again")

    return {
        "status": "pending_approval",
        "message": "Your account was created and is awaiting admin approval.",
    }


@router.post("/login")
async def login(req: LoginRequest):
    rate_key = f"{RATE_LIMIT_KEY_PREFIX}{req.email.strip().lower()}"
    attempts = await cache_get(rate_key, "auth") or 0
    if attempts >= RATE_LIMIT_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please try again in a few minutes.",
        )

    user = await get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        await cache_set(rate_key, attempts + 1, "auth")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user["status"] == "pending":
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
    if user["status"] == "rejected":
        raise HTTPException(status_code=403, detail="Your account access was not approved.")

    token = await create_session(str(user["id"]))
    if not token:
        raise HTTPException(status_code=500, detail="Could not start session — please try again")

    return {
        "status": "success",
        "session_token": token,
        "user": {"id": str(user["id"]), "email": user["email"], "role": user["role"]},
    }


@router.post("/logout")
async def logout(creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)):
    """תמיד מחזיר הצלחה — logout הוא idempotent מנקודת המבט של הלקוח."""
    if creds:
        await delete_session(creds.credentials)
    return {"status": "success"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {**user, "status": "approved"}

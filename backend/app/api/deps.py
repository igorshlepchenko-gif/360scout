"""
360SCOUT — Auth Dependencies
get_current_user אוכף idle timeout + absolute expiry + status='approved' בכל בקשה
(לא רק בהתחברות — כך ש-reject חוסם מיידית, לא רק בפעם הבאה שהסשן נבדק ממטמון).
require_admin נבנה מעליו. אלה נקודת האכיפה היחידה שכל ה-router המוגן תלוי בה.
"""

import os
import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.db.auth_repository import get_session_with_user, touch_session, delete_session

logger = logging.getLogger(__name__)

# נקרא פעם אחת ב-import — שינוי ב-.env דורש restart, לא hot-reload
SESSION_IDLE_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "20"))

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = creds.credentials
    session = await get_session_with_user(token)
    if session is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    now = datetime.now(timezone.utc)
    idle_seconds = (now - session["last_seen_at"]).total_seconds()

    if (
        now > session["expires_at"]
        or idle_seconds > SESSION_IDLE_MINUTES * 60
        or session["status"] != "approved"
    ):
        await delete_session(token)
        raise HTTPException(status_code=401, detail="Session expired")

    await touch_session(token)
    return {"id": str(session["user_id"]), "email": session["email"], "role": session["role"]}


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

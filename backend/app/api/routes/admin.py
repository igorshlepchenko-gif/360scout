"""
360SCOUT — Admin Routes
ניהול אישור משתמשים. dependencies ברמת ה-router — שורה אחת מגנה על כל שלוש הנקודות.
"""

from fastapi import APIRouter, HTTPException, Depends

from app.db.auth_repository import list_users_by_status, approve_user, reject_user
from app.api.deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _serialize(u: dict) -> dict:
    return {
        **u,
        "id": str(u["id"]),
        "approved_by": str(u["approved_by"]) if u.get("approved_by") else None,
        "created_at": u["created_at"].isoformat() if u.get("created_at") else None,
        "approved_at": u["approved_at"].isoformat() if u.get("approved_at") else None,
    }


@router.get("/users")
async def list_users(status: str = "pending"):
    if status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="status must be pending, approved, or rejected")
    users = await list_users_by_status(status)
    return {"status": "success", "count": len(users), "users": [_serialize(u) for u in users]}


@router.post("/users/{user_id}/approve")
async def approve(user_id: str, admin: dict = Depends(require_admin)):
    ok = await approve_user(user_id, approved_by=admin["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "success"}


@router.post("/users/{user_id}/reject")
async def reject(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot reject your own account")
    ok = await reject_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "success"}

from fastapi import APIRouter, HTTPException, Query, Depends

from backend.app.repositories.transaction_repository import db_repo
from backend.app.schemas.transaction import SuspendAccountRequest, ReviewSuspendRequest
from backend.app.auth import require_admin, get_current_user

router = APIRouter()

# Account-suspension workflow. A HIGH-risk transaction is auto-BLOCKED by the
# model and is NEVER modified here: an analyst simply files a request against
# the sender account (with a recommendation note) for the admin to approve
# (=> account added to the blocklist) or decline. Requests are scoped so an
# analyst only ever sees their own; admins see everything.


@router.post("/accounts/{account_id}/suspend-request")
def create_suspend_request(
    account_id: str,
    payload: SuspendAccountRequest,
    current_user: dict = Depends(get_current_user),
):
    """Any signed-in user (analyst) requests suspension of the sender account
    behind an auto-BLOCKED high-risk transaction. Exactly one PENDING request
    per account is allowed; after a decline it can be re-requested."""
    note = (payload.note or "").strip()
    try:
        result = db_repo.create_suspend_request(
            account_id=account_id,
            source_txn_id=payload.source_txn_id,
            requested_by=current_user["email"],
            note=note,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create suspension request: {str(e)}")

    if result.get("error") == "txn_not_found":
        raise HTTPException(status_code=404, detail="Source transaction not found.")
    if result.get("error") == "not_high_risk":
        raise HTTPException(
            status_code=400,
            detail="An account-suspension request can only be raised from an auto-BLOCKED HIGH-risk transaction.",
        )
    if result.get("error") == "already_requested":
        raise HTTPException(
            status_code=409,
            detail="This account already has a suspension request awaiting admin review.",
        )
    return result


@router.get("/accounts/suspend-requests")
def list_suspend_requests(
    status: str = Query("", description="PENDING | APPROVED | DECLINED (empty = all)"),
    mine: bool = Query(False, description="Only this user's own requests (always true for analysts)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """List account-suspension requests. Analysts always see only their own;
    admins see all (unless mine=true)."""
    status_filter = status.strip().upper()
    if status_filter and status_filter not in ("PENDING", "APPROVED", "DECLINED"):
        raise HTTPException(status_code=400, detail="status must be PENDING, APPROVED or DECLINED.")

    requested_by = ""
    if mine or current_user.get("role") != "admin":
        requested_by = current_user["email"]

    try:
        items = db_repo.list_suspend_requests(
            status=status_filter, requested_by=requested_by, limit=limit, offset=offset
        )
        total = db_repo.count_suspend_requests(status=status_filter, requested_by=requested_by)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/accounts/suspend-requests/sla")
def suspend_request_sla(
    mine: bool = Query(False, description="Only this user's own requests (always true for analysts)"),
    current_user: dict = Depends(get_current_user),
):
    """SLA distribution of account-suspension requests, bucketed by how long
    the admin took to decide (reviewed_at - requested_at). Analysts are scoped
    to their own; admins see all unless mine=true."""
    requested_by = ""
    if mine or current_user.get("role") != "admin":
        requested_by = current_user["email"]
    try:
        return db_repo.suspend_request_sla(requested_by=requested_by)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/accounts/suspend-requests/{request_id}/review")
def review_suspend_request(
    request_id: str,
    payload: ReviewSuspendRequest,
    current_user: dict = Depends(require_admin),
):
    """Admin-only: approve (account is added to the blocklist) or decline a
    pending account-suspension request. Enforced server-side via require_admin."""
    decision = (payload.decision or "").strip().upper()
    if decision not in ("APPROVED", "DECLINED"):
        raise HTTPException(status_code=400, detail="decision must be 'APPROVED' or 'DECLINED'.")

    try:
        result = db_repo.review_suspend_request(request_id, decision, reviewed_by=current_user["email"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to review suspension request: {str(e)}")

    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail="Suspension request not found.")
    if result.get("error") == "already_reviewed":
        raise HTTPException(status_code=400, detail="This request has already been reviewed.")
    return result


@router.get("/accounts/blocked")
def get_blocked_accounts(current_user: dict = Depends(require_admin)):
    """Admin: the current account blocklist (approved suspensions)."""
    try:
        return {"items": db_repo.get_blocked_accounts(active=1)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/accounts/{account_id}/block")
def unblock_account(account_id: str, current_user: dict = Depends(require_admin)):
    """Admin: lift a previously approved account suspension (sets active=0,
    preserving the audit trail)."""
    try:
        result = db_repo.unblock_account(account_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unblock account: {str(e)}")
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail="Account is not on the blocklist.")
    return result

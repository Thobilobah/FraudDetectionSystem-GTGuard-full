from fastapi import APIRouter, HTTPException, Query, Depends, Response
from backend.app.repositories.transaction_repository import db_repo
from backend.app.schemas.transaction import ResolveTransactionRequest
from backend.app.auth import require_admin, get_current_user
import json
import csv
import io
from datetime import date

router = APIRouter()

@router.get("/transactions")
def get_transactions(limit: int = Query(100, ge=1, le=1000)):
    try:
        txns = db_repo.get_all_transactions(limit=limit)
        
        # Deserialize JSON rules for frontend mapping
        for txn in txns:
            if "triggered_rules" in txn and isinstance(txn["triggered_rules"], str):
                try:
                    txn["triggered_rules"] = json.loads(txn["triggered_rules"])
                except Exception:
                    txn["triggered_rules"] = []
                    
        return txns
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/transactions/export")
def export_transactions_csv(
    start_date: str = Query(..., description="ISO date, e.g. 2026-09-01"),
    end_date: str = Query(..., description="ISO date, e.g. 2026-09-18"),
    current_user: dict = Depends(require_admin)
):
    """Admin-only: download a CSV report of every transaction in the given
    date range, including who claimed/reviewed and who ultimately resolved
    each one - so an admin can see exactly which analyst worked on what."""
    try:
        date.fromisoformat(start_date)
        date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date and end_date must be ISO dates (YYYY-MM-DD).")

    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must not be before start_date.")

    try:
        txns = db_repo.get_transactions_in_range(start_date, end_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch transactions for export: {str(e)}")

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Timestamp", "Transaction ID", "User Account", "Beneficiary", "Method",
        "Amount (NGN)", "Risk Score", "Risk Level", "Decision",
        "Resolved By", "Resolved At", "Flagged By", "Flagged At",
    ])
    for t in txns:
        writer.writerow([
            t.get("created_at") or t.get("timestamp") or "",
            t.get("transaction_id") or "",
            t.get("user_id") or "",
            t.get("beneficiary_id") or "",
            t.get("payment_method") or "",
            t.get("amount") if t.get("amount") is not None else "",
            t.get("risk_score") if t.get("risk_score") is not None else "",
            t.get("risk_level") or "",
            t.get("status") or "",
            t.get("resolved_by") or "",
            t.get("resolved_at") or "",
            t.get("claimed_by") or "",
            t.get("claimed_at") or "",
        ])

    filename = f"gt-guard-transactions_{start_date}_to_{end_date}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/transactions/{txn_id}/suspend")
def suspend_transaction(
    txn_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Any signed-in user (analyst or admin) can flag a PENDING (medium-risk)
    transaction. This is a deliberate action, not automatic: it moves the
    transaction to SUSPENDED and records who flagged it, in one step, so
    everyone (on any device) can see it's now being handled and by whom.
    Resolving it afterward still requires admin via PATCH /transactions/{txn_id}/resolve."""
    try:
        result = db_repo.suspend_transaction(txn_id, flagged_by_email=current_user["email"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to suspend transaction: {str(e)}")

    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if result.get("error") == "not_pending":
        raise HTTPException(status_code=400, detail="Only a PENDING transaction can be suspended.")

    if isinstance(result.get("triggered_rules"), str):
        try:
            result["triggered_rules"] = json.loads(result["triggered_rules"])
        except Exception:
            result["triggered_rules"] = []

    return result


@router.patch("/transactions/{txn_id}/resolve")
def resolve_transaction(
    txn_id: str,
    payload: ResolveTransactionRequest,
    current_user: dict = Depends(require_admin)
):
    """Admin-only: resolve a PENDING or SUSPENDED (MEDIUM risk) transaction to
    either APPROVED or BLOCKED. Works whether or not an analyst has flagged
    it first. Enforced server-side via require_admin - a non-admin token
    gets a 403 here even if it were somehow sent."""
    decision = (payload.decision or "").strip().upper()
    if decision not in ("APPROVED", "BLOCKED"):
        raise HTTPException(status_code=400, detail="decision must be 'APPROVED' or 'BLOCKED'.")

    try:
        updated = db_repo.resolve_transaction(txn_id, decision, resolved_by=current_user["email"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve transaction: {str(e)}")

    if not updated:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    if isinstance(updated.get("triggered_rules"), str):
        try:
            updated["triggered_rules"] = json.loads(updated["triggered_rules"])
        except Exception:
            updated["triggered_rules"] = []

    return updated


@router.get("/transactions/{txn_id}")
def get_transaction_by_id(txn_id: str):
    try:
        conn = db_repo.get_connection()
        cursor = conn.execute("SELECT * FROM transactions WHERE transaction_id = ?", (txn_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail="Transaction not found")
            
        txn = dict(row)
        if "triggered_rules" in txn and isinstance(txn["triggered_rules"], str):
            try:
                txn["triggered_rules"] = json.loads(txn["triggered_rules"])
            except Exception:
                txn["triggered_rules"] = []
                
        return txn
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

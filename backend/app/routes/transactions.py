from fastapi import APIRouter, HTTPException, Query, Depends
from backend.app.repositories.transaction_repository import db_repo
from backend.app.schemas.transaction import ResolveTransactionRequest
from backend.app.auth import require_admin
import json

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

@router.patch("/transactions/{txn_id}/resolve")
def resolve_transaction(
    txn_id: str,
    payload: ResolveTransactionRequest,
    current_user: dict = Depends(require_admin)
):
    """Admin-only: resolve a SUSPENDED (MEDIUM risk) transaction to either
    APPROVED or BLOCKED. Enforced server-side via require_admin - a
    non-admin token gets a 403 here even if it were somehow sent."""
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

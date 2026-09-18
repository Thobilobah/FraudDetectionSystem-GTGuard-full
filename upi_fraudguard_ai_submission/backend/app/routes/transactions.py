from fastapi import APIRouter, HTTPException, Query
from backend.app.repositories.transaction_repository import db_repo
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

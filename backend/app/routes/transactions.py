from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from backend.app.repositories.transaction_repository import db_repo
from backend.app.schemas.transaction import (
    ResolveTransactionRequest, BulkSuspendRequest, BulkResolveRequest
)
from backend.app.auth import require_admin, get_current_user
import json
import csv
import io
import time
from datetime import date

router = APIRouter()

# Server-side throttle for the policy sweep: dashboard polls fire it every
# 10s, but the sweep itself only actually runs once per this interval, so
# poll traffic costs a single timestamp comparison.
_LAST_AUTO_RESOLVE_RUN = 0.0
AUTO_RESOLVE_MIN_INTERVAL_S = 60.0

@router.get("/transactions")
def get_transactions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str = Query("", description="Partial match on transaction_id, user_id or beneficiary_id"),
    risk_level: str = Query("", description="LOW | MEDIUM | HIGH (empty = all)"),
    status: str = Query("", description="APPROVED | PENDING | SUSPENDED | BLOCKED | RESOLVED (= APPROVED+BLOCKED) (empty = all)"),
    sort: str = Query("desc", description="desc (newest first) | asc (oldest first/ageing) | risk (highest risk score first)"),
    flagged_by: str = Query("", description="Exact claimant email - each analyst's own flagged work"),
):
    try:
        # Paginated + filtered ledger. Returns {items, total, limit, offset} so
        # the history page can paginate the FULL history, not just a 100-row
        # poll cache. ORDER BY rides idx_txn_created; filters are bound params.
        sort = sort if sort in ("desc", "asc", "risk") else "desc"
        txns = db_repo.get_transactions_page(
            limit=limit, offset=offset,
            search=search.strip(), risk_level=risk_level.strip(), status=status.strip(),
            sort=sort, flagged_by=flagged_by.strip(),
        )
        total = db_repo.count_transactions(
            search=search.strip(), risk_level=risk_level.strip(), status=status.strip(),
            flagged_by=flagged_by.strip(),
        )

        # Deserialize JSON rules for frontend mapping
        for txn in txns:
            if "triggered_rules" in txn and isinstance(txn["triggered_rules"], str):
                try:
                    txn["triggered_rules"] = json.loads(txn["triggered_rules"])
                except Exception:
                    txn["triggered_rules"] = []

        return {"items": txns, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transactions/purge-internal")
def purge_internal_transactions(current_user: dict = Depends(require_admin)):
    """Admin-only maintenance: remove the txn_hist_* / txn_velocity_* demo
    support rows that older scenario generators persisted into the ledger.
    The generator now builds those rows in memory, so this only needs to run
    once to clear the phantom entries from Live Monitor / Transaction History."""
    try:
        deleted = db_repo.purge_internal_transactions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to purge internal rows: {str(e)}")
    return {"deleted": deleted}

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
        # Validate the date range before opening the server-side cursor
        date.fromisoformat(start_date)
        date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date and end_date must be ISO dates (YYYY-MM-DD).")

    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must not be before start_date.")

    filename = f"gt-guard-transactions_{start_date}_to_{end_date}.csv"
    header = [
        "Timestamp", "Transaction ID", "User Account", "Beneficiary", "Method",
        "Amount (NGN)", "Risk Score", "Risk Level", "Decision",
        "Resolved By", "Resolved At", "Flagged By", "Flagged At",
    ]

    def _csv_line(values: list) -> str:
        row_buffer = io.StringIO()
        csv.writer(row_buffer).writerow(values)
        return row_buffer.getvalue()

    def _stream():
        # Rows are yielded straight off a server-side (named) cursor in
        # batches - the full date range never materializes in memory here.
        yield _csv_line(header)
        try:
            txns_iter = db_repo.stream_transactions_in_range(start_date, end_date)
            for t in txns_iter:
                yield _csv_line([
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
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch transactions for export: {str(e)}")

    return StreamingResponse(
        _stream(),
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


@router.post("/transactions/bulk-suspend")
def bulk_suspend_transactions(
    payload: BulkSuspendRequest,
    current_user: dict = Depends(get_current_user),
):
    """Analyst batch-flag: same semantics as the single suspend, per row -
    PENDING -> SUSPENDED with claimed_by stamped to this user. Rows that are
    missing or no longer PENDING are reported as failures, not errors, so one
    stale id never rolls back the rest of the batch."""
    succeeded, failed = [], []
    for txn_id in payload.transaction_ids:
        result = db_repo.suspend_transaction(txn_id, flagged_by_email=current_user["email"])
        if "error" in result:
            failed.append({"transaction_id": txn_id, "reason": result["error"]})
        else:
            succeeded.append(txn_id)
    return {"succeeded": succeeded, "failed": failed}


@router.post("/transactions/bulk-resolve")
def bulk_resolve_transactions(
    payload: BulkResolveRequest,
    current_user: dict = Depends(require_admin),
):
    """Admin batch decision: APPROVED or BLOCKED for up to 100 rows in one
    round-trip. Statuses are checked up front so only PENDING/SUSPENDED work
    is touched (resolved rows are reported as 'not_resolvable'), and each
    success carries its own resolved_by/resolved_at stamp."""
    decision = (payload.decision or "").strip().upper()
    if decision not in ("APPROVED", "BLOCKED"):
        raise HTTPException(status_code=400, detail="decision must be 'APPROVED' or 'BLOCKED'.")

    ids = list(dict.fromkeys(payload.transaction_ids))  # de-dupe, keep order
    with db_repo.get_connection() as conn:
        cursor = conn.execute(
            "SELECT transaction_id, status FROM transactions WHERE transaction_id = ANY(?)",
            (ids,),
        )
        statuses = {r["transaction_id"]: r["status"] for r in cursor.fetchall()}

    succeeded, failed = [], []
    for txn_id in ids:
        status = statuses.get(txn_id)
        if status is None:
            failed.append({"transaction_id": txn_id, "reason": "not_found"})
        elif status not in ("PENDING", "SUSPENDED"):
            failed.append({"transaction_id": txn_id, "reason": "not_resolvable"})
        else:
            updated = db_repo.resolve_transaction(txn_id, decision, resolved_by=current_user["email"])
            if updated:
                succeeded.append(txn_id)
            else:
                failed.append({"transaction_id": txn_id, "reason": "not_found"})
    return {"succeeded": succeeded, "failed": failed}


@router.get("/transactions/queue-metrics")
def get_queue_metrics(current_user: dict = Depends(require_admin)):
    """Admin: one round-trip backlog/throughput stats for the Review Queue
    strip, the nav badge and the dashboard card."""
    try:
        return db_repo.queue_metrics()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transactions/auto-resolve-run")
def run_auto_resolve(current_user: dict = Depends(get_current_user)):
    """Policy sweep trigger - cheap enough for the dashboard's 10s poll: the
    server only executes the sweep once per minute (throttled below), all
    other calls return {'skipped': true} instantly. Conservative defaults:
    unclaimed MEDIUM txns with score <= 45, untouched for 15 min, no CRITICAL
    rules -> APPROVED as 'system:policy'. SUSPENDED rows are never touched."""
    global _LAST_AUTO_RESOLVE_RUN
    now = time.time()
    if now - _LAST_AUTO_RESOLVE_RUN < AUTO_RESOLVE_MIN_INTERVAL_S:
        return {"skipped": True, "resolved": 0}
    _LAST_AUTO_RESOLVE_RUN = now
    try:
        return db_repo.run_auto_resolve_policy()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-resolve sweep failed: {str(e)}")


@router.get("/transactions/outcomes")
def get_recent_outcomes(
    risk_level: str = Query("MEDIUM", description="LOW | MEDIUM | HIGH"),
    days: int = Query(7, ge=1, le=90),
    current_user: dict = Depends(get_current_user),
):
    """Decision support for the detail modal: how transactions of this risk
    level resolved over the last N days (base rate before you decide)."""
    try:
        return db_repo.recent_outcomes(risk_level=risk_level.upper(), days=days)
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

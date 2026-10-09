import React, { useState, useEffect, useRef } from "react";
import type { Transaction } from "../types";
import { resolveTransaction, suspendTransaction, bulkSuspendTransactions, authenticateTransaction, getStoredUser, getTransactionsPage } from "../services/api";
import { ShieldCheck, ShieldAlert, AlertCircle, RefreshCw, MapPin, Tablet, UserCheck, Shield, Activity, PauseCircle, Loader2, User, ChevronLeft, ChevronRight, Search, Fingerprint, Clock } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { parseApiTimestamp } from "../utils/time";
import { formatPlace, isInNigeria } from "../utils/nigeriaPlaces";

interface LiveMonitorProps {
  onRefresh: () => void;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export const LiveMonitor: React.FC<LiveMonitorProps> = ({ onRefresh }) => {
  const { showToast } = useToast();
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [authingId, setAuthingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Server-side pagination of the ledger, mirroring TransactionHistory. The
  // monitor no longer renders the shared 100-row poll cache; it fetches only
  // the active page (newest-first) and keeps refreshing it silently on a 10s
  // cadence so new events still roll in "live".
  const [page, setPage] = useState(0); // zero-based
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Search is applied explicitly (button or Enter), not per keystroke. The
  // backend matches transaction_id, user_id or beneficiary_id.
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const firstLoadDone = useRef(false);
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === "admin";
  // Analyst bulk-suspend: multi-select PENDING rows, then one batch call.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Re-fetch the active page without flipping the loading flag, so periodic
  // refreshes don't dim the table. Errors keep the previous rows on screen.
  const reloadCurrentPage = async () => {
    const data = await getTransactionsPage({
      limit: pageSize,
      offset: page * pageSize,
      search: appliedSearch,
      sort: "desc",
    });
    setRows(data.items);
    setTotal(data.total);
  };

  // Initial load + page/page-size/search changes: show the spinner and snap
  // back to the last valid page if a change empties the current one.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setIsLoading(true);
    getTransactionsPage({ limit: pageSize, offset: page * pageSize, search: appliedSearch, sort: "desc" })
      .then((data) => {
        if (cancelled) return;
        setRows(data.items);
        setTotal(data.total);
        if (data.items.length === 0 && data.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(data.total / pageSize) - 1));
        }
        firstLoadDone.current = true;
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load monitor stream:", e);
        setLoadError("Could not load the surveillance stream. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, appliedSearch]);

  // Silent auto-refresh so the stream keeps rolling in while you stay on it.
  useEffect(() => {
    const id = setInterval(() => {
      reloadCurrentPage().catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [page, pageSize, appliedSearch]);

  const applySearch = () => {
    setAppliedSearch(searchTerm.trim());
    setPage(0);
  };

  // Drop selections for rows that left PENDING (resolved, suspended by a
  // colleague, or rolled to the next page) so the toolbar count is always true.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const pendingNow = new Set(
        rows.filter((r) => r.status === "PENDING" && r.required_action !== "USER_AUTH").map((r) => r.transaction_id)
      );
      const next = new Set([...prev].filter((id) => pendingNow.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggleSelect = (txnId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(txnId)) next.delete(txnId);
      else next.add(txnId);
      return next;
    });
    setBulkConfirm(false);
  };

  const toggleSelectAllPending = () => {
    const pendingOnPage = rows.filter((r) => r.status === "PENDING" && r.required_action !== "USER_AUTH").map((r) => r.transaction_id);
    const allSelected = pendingOnPage.length > 0 && pendingOnPage.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(pendingOnPage));
    setBulkConfirm(false);
  };

  const handleBulkSuspend = async () => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await bulkSuspendTransactions([...selectedIds]);
      const failedCount = result.failed.length;
      showToast(
        "suspended",
        `${result.succeeded.length} transaction${result.succeeded.length === 1 ? "" : "s"} suspended`,
        failedCount > 0
          ? `${failedCount} skipped (already actioned or not found).`
          : "Flagged under your name, pending admin review."
      );
      setSelectedIds(new Set());
      setBulkConfirm(false);
      await reloadCurrentPage();
      void onRefresh();
    } catch (e: any) {
      console.error("Bulk suspend failed:", e);
      const detail = e?.response?.data?.detail;
      showToast("danger", "Bulk suspend failed", typeof detail === "string" ? detail : "Could not suspend the selected transactions.");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await reloadCurrentPage();
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleResolve = async (txnId: string, decision: "APPROVED" | "BLOCKED") => {
    setResolvingId(txnId);
    try {
      const updated = await resolveTransaction(txnId, decision);
      if (selectedTxn?.transaction_id === txnId) {
        setSelectedTxn({ ...selectedTxn, ...updated });
      }
      if (decision === "APPROVED") {
        showToast("success", "Transaction approved", `${txnId} has been cleared and marked APPROVED.`);
      } else {
        showToast("danger", "Transaction blocked", `${txnId} has been declined and marked BLOCKED.`);
      }
      await reloadCurrentPage();
      void onRefresh();
    } catch (e) {
      console.error("Failed to resolve transaction:", e);
      showToast("danger", "Action failed", "Could not resolve this transaction. Please try again.");
    } finally {
      setResolvingId(null);
    }
  };

  const handleSuspend = async (txnId: string) => {
    setClaimingId(txnId);
    setClaimError(null);
    try {
      const updated = await suspendTransaction(txnId);
      if (selectedTxn?.transaction_id === txnId) {
        setSelectedTxn({ ...selectedTxn, ...updated });
      }
      showToast("suspended", "Transaction suspended", `${txnId} is now flagged under your name, pending admin review.`);
      await reloadCurrentPage();
      void onRefresh();
    } catch (e: any) {
      // Most likely a 400: someone else already suspended it a moment before
      // this click landed (it's no longer PENDING). Surface that clearly.
      const detail = e?.response?.data?.detail;
      setClaimError(detail || "Could not suspend this transaction. It may have already been handled.");
      await reloadCurrentPage();
      void onRefresh();
    } finally {
      setClaimingId(null);
    }
  };

  const handleAuthenticate = async (txnId: string) => {
    setAuthingId(txnId);
    try {
      const updated = await authenticateTransaction(txnId);
      if (selectedTxn?.transaction_id === txnId) {
        setSelectedTxn({ ...selectedTxn, ...updated });
      }
      showToast("success", "Customer authenticated", `${txnId} cleared the authentication hold and is now APPROVED.`);
      await reloadCurrentPage();
      void onRefresh();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      showToast("danger", "Authentication failed", typeof detail === "string" ? detail : "Could not authenticate this transaction. Please try again.");
      await reloadCurrentPage();
      void onRefresh();
    } finally {
      setAuthingId(null);
    }
  };

  const getRiskBadge = (level: string | null) => {
    switch (level) {
      case "LOW":
        return <span className="bg-brand-success/15 text-brand-success border border-brand-success/20 px-2 py-0.5 rounded text-[11px] font-bold">LOW</span>;
      case "MEDIUM":
        return <span className="bg-brand-warning/15 text-brand-warning border border-brand-warning/20 px-2 py-0.5 rounded text-[11px] font-bold">MEDIUM</span>;
      case "HIGH":
        return <span className="bg-brand-danger/15 text-brand-danger border border-brand-danger/20 px-2 py-0.5 rounded text-[11px] font-bold">HIGH</span>;
      default:
        return <span className="bg-dark-muted/15 text-dark-muted border border-dark-border px-2 py-0.5 rounded text-[11px] font-bold">UNRANKED</span>;
    }
  };

  // A MEDIUM hold in the 40-45 band: status stays PENDING but the ball is in
  // the customer's court (OTP / biometric) - not analyst work.
  const isAuthHold = (txn: Transaction) =>
    txn.status === "PENDING" && txn.required_action === "USER_AUTH";

  const getStatusDisplay = (status: string | null | undefined, requiredAction?: string | null) => {
    if (status === "PENDING" && requiredAction === "USER_AUTH") {
      return (
        <div className="flex items-center gap-1 text-brand-warning font-semibold text-xs" title="Awaiting the customer's authentication - auto-blocks in 15 min if unanswered">
          <Fingerprint className="h-4 w-4" /> Awaiting User Auth
        </div>
      );
    }
    if (status === "PENDING") {
      return (
        <div className="flex items-center gap-1 text-brand-info font-semibold text-xs">
          <AlertCircle className="h-4 w-4" /> Pending
        </div>
      );
    }
    if (status === "SUSPENDED") {
      return (
        <div className="flex items-center gap-1 text-guard-orange font-semibold text-xs">
          <PauseCircle className="h-4 w-4" /> Suspended
        </div>
      );
    }
    if (status === "BLOCKED") {
      return (
        <div className="flex items-center gap-1 text-brand-danger font-semibold text-xs">
          <ShieldAlert className="h-4 w-4" /> Blocked
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 text-brand-success font-semibold text-xs">
        <ShieldCheck className="h-4 w-4" /> Approved
      </div>
    );
  };

  // ACTION cell: LOW -> plain "Approved" label, HIGH -> plain "Blocked" label.
  // MEDIUM starts as PENDING (nobody has acted on it yet):
  //   - admins can resolve it immediately (Approve/Block), bypassing analysts entirely
  //   - analysts get a "Suspend Transaction" button - clicking it is a deliberate
  //     flag: it moves the transaction to SUSPENDED and records their email as
  //     who flagged it, in one action.
  // Once SUSPENDED, admins keep their Approve/Block buttons (now alongside the
  // flagged-by icon), and analysts see a read-only icon - clicking it (or the
  // row) reveals who flagged it in the detail panel, rather than spelling the
  // email out in the table itself.
  const getActionCell = (txn: Transaction) => {
    const isBusy = resolvingId === txn.transaction_id;
    const isSuspending = claimingId === txn.transaction_id;
    const isFlagged = !!txn.claimed_by;

    const flaggedIcon = (
      <div
        className="flex items-center justify-center h-[22px] w-[22px] rounded-full bg-guard-orangeLight border border-guard-orange/40 text-guard-orange shrink-0"
        title="This transaction has been flagged - click to see who"
      >
        <User className="h-3 w-3" />
      </div>
    );

    const resolveButtons = (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          disabled={isBusy}
          onClick={() => handleResolve(txn.transaction_id, "APPROVED")}
          className="text-[10px] font-bold px-1.5 py-1 rounded-md bg-brand-success/10 text-brand-success border border-brand-success/30 hover:bg-brand-success/20 transition disabled:opacity-50 whitespace-nowrap"
        >
          Approve
        </button>
        <button
          disabled={isBusy}
          onClick={() => handleResolve(txn.transaction_id, "BLOCKED")}
          className="text-[10px] font-bold px-1.5 py-1 rounded-md bg-brand-danger/10 text-brand-danger border border-brand-danger/30 hover:bg-brand-danger/20 transition disabled:opacity-50 whitespace-nowrap"
        >
          Block
        </button>
        {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-dark-muted" />}
        {isFlagged && (
          <span onClick={() => setSelectedTxn(txn)} className="cursor-pointer">
            {flaggedIcon}
          </span>
        )}
      </div>
    );

    if (isAuthHold(txn)) {
      // Customer-auth hold: not analyst work. Admins may still override.
      if (isAdmin) return resolveButtons;
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md bg-brand-warning/10 text-brand-warning border border-brand-warning/30 whitespace-nowrap">
          <Fingerprint className="h-3 w-3" /> Awaiting user auth
        </span>
      );
    }

    if (txn.status === "PENDING") {
      if (isAdmin) return resolveButtons;
      return (
        <button
          disabled={isSuspending}
          onClick={(e) => { e.stopPropagation(); handleSuspend(txn.transaction_id); }}
          className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md bg-guard-orangeLight text-guard-orange border border-guard-orange/30 hover:bg-guard-orange/20 transition disabled:opacity-50"
        >
          {isSuspending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PauseCircle className="h-3 w-3" />}
          {isSuspending ? "Suspending..." : "Suspend Transaction"}
        </button>
      );
    }

    if (txn.status === "SUSPENDED") {
      if (isAdmin) return resolveButtons;

      if (isFlagged) {
        return (
          <span onClick={(e) => { e.stopPropagation(); setSelectedTxn(txn); }} className="cursor-pointer inline-flex">
            {flaggedIcon}
          </span>
        );
      }
      return <span className="text-xs font-semibold text-guard-orange">Suspended</span>;
    }

    if (txn.status === "BLOCKED") {
      return <span className="text-xs font-bold text-brand-danger">Blocked</span>;
    }
    return <span className="text-xs font-bold text-brand-success">Approved</span>;
  };

  return (
    <div className="space-y-6">
      {claimError && (
        <div className="bg-brand-danger/10 border border-brand-danger/30 text-brand-danger text-xs font-semibold rounded-lg px-4 py-3 flex items-center justify-between">
          <span>{claimError}</span>
          <button onClick={() => setClaimError(null)} className="text-brand-danger/70 hover:text-brand-danger font-bold px-2">✕</button>
        </div>
      )}
      {/* Title Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-dark-text">Live Transaction Monitor</h1>
          <p className="text-dark-muted mt-1">Real-time surveillance & automated ML model analytics</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="bg-dark-card border border-dark-border hover:border-guard-orange text-dark-text px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold transition hover:scale-[1.02] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-guard-orange" : ""}`} /> 
          Refresh Feeds
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Logs Table */}
        <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden lg:col-span-2">
          <div className="px-5 py-3.5 border-b border-dark-border flex items-center justify-between gap-3 flex-wrap lg:flex-nowrap">
            <div className="flex items-center gap-3 shrink-0">
              <h3 className="text-base font-semibold text-dark-text whitespace-nowrap">Surveillance Stream</h3>
              <span className="text-[10px] bg-guard-orangeLight text-guard-orange font-bold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap">
                {total.toLocaleString()} Total
              </span>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); applySearch(); }}
              className="flex items-center gap-1.5 w-full lg:w-auto"
            >
              <div className="relative flex-1 min-w-0 lg:flex-initial lg:w-44 xl:w-52">
                <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-dark-muted">
                  <Search className="h-3.5 w-3.5" />
                </span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search transaction or customer ID..."
                  className="w-full bg-dark-bg border border-dark-border text-dark-text text-xs rounded-md pl-8 pr-2.5 py-1.5 focus:border-guard-orange focus:outline-none placeholder:text-dark-muted/60"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-md bg-guard-orange text-white hover:bg-guard-orange/90 transition disabled:opacity-50 whitespace-nowrap"
              >
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Search
              </button>
              {appliedSearch && (
                <button
                  type="button"
                  onClick={() => { setSearchTerm(""); setAppliedSearch(""); setPage(0); }}
                  className="text-[11px] font-bold px-2 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text hover:border-guard-orange transition whitespace-nowrap"
                  title="Clear search"
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {/* Analyst bulk-suspend toolbar (appears once rows are selected) */}
          {!isAdmin && selectedIds.size > 0 && (
            <div className="px-4 py-2.5 border-b border-dark-border bg-guard-orangeLight/40 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-guard-orange">
                {selectedIds.size} PENDING transaction{selectedIds.size === 1 ? "" : "s"} selected
              </span>
              <div className="flex items-center gap-2">
                {bulkConfirm ? (
                  <>
                    <span className="text-xs font-semibold text-dark-text">
                      Flag all {selectedIds.size} under your name?
                    </span>
                    <button
                      onClick={handleBulkSuspend}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md bg-guard-orange text-white hover:bg-guard-orange/90 transition disabled:opacity-50"
                    >
                      {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                      {bulkBusy ? "Suspending..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => setBulkConfirm(false)}
                      disabled={bulkBusy}
                      className="text-xs font-bold px-3 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text transition"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setBulkConfirm(true)}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md bg-guard-orange text-white hover:bg-guard-orange/90 transition disabled:opacity-50"
                    >
                      <PauseCircle className="h-3.5 w-3.5" /> Suspend selected ({selectedIds.size})
                    </button>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-xs font-bold px-3 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text transition"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            {rows.length > 0 || isLoading ? (
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-100/70 dark:bg-dark-card text-[11px] text-dark-muted uppercase font-bold tracking-wider sticky top-0">
                  <tr>
                    {!isAdmin && (
                      <th className="px-3 py-3 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all pending rows on this page"
                          checked={
                            rows.filter((r) => r.status === "PENDING" && r.required_action !== "USER_AUTH").length > 0 &&
                            rows.filter((r) => r.status === "PENDING" && r.required_action !== "USER_AUTH").every((r) => selectedIds.has(r.transaction_id))
                          }
                          onChange={toggleSelectAllPending}
                          className="accent-guard-orange align-middle"
                        />
                      </th>
                    )}
                    <th className="px-3 py-3">Txn ID</th>
                    <th className="px-3 py-3">User</th>
                    <th className="px-3 py-3">Amount</th>
                    <th className="px-3 py-3">Risk score</th>
                    <th className="px-3 py-3">Action</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-dark-border text-sm">
                  {isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 7 : 8} className="px-3 py-12 text-center">
                        <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
                        <p className="text-xs text-dark-muted mt-2">Loading stream…</p>
                      </td>
                    </tr>
                  )}
                  {rows.map((txn, idx) => (
                    <tr
                      key={txn.transaction_id || idx}
                      onClick={() => setSelectedTxn(txn)}
                      className={`hover:bg-dark-border/25 cursor-pointer transition ${
                        isLoading ? "opacity-50" : ""
                      } ${
                        selectedTxn?.transaction_id === txn.transaction_id ? "bg-guard-orangeLight/40 border-l-4 border-l-guard-orange" : ""
                      } ${txn.status === "SUSPENDED" ? "bg-guard-orangeLight/60" : ""} ${isAuthHold(txn) ? "bg-brand-warning/5" : txn.status === "PENDING" ? "bg-brand-info/5" : ""}`}
                    >
                      {!isAdmin && (
                        <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                          {txn.status === "PENDING" && txn.required_action !== "USER_AUTH" ? (
                            <input
                              type="checkbox"
                              aria-label={`Select ${txn.transaction_id}`}
                              checked={selectedIds.has(txn.transaction_id)}
                              onChange={() => toggleSelect(txn.transaction_id)}
                              className="accent-guard-orange align-middle"
                            />
                          ) : null}
                        </td>
                      )}
                      <td className="px-3 py-3.5 text-xs font-semibold text-dark-text">
                        {txn.transaction_id}
                      </td>
                      <td className="px-3 py-3.5 text-dark-text font-medium">{txn.user_id}</td>
                      <td className="px-3 py-3.5 text-dark-text font-semibold">₦{txn.amount.toLocaleString('en-NG')}</td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          {getRiskBadge(txn.risk_level)}
                          <span className="text-xs font-semibold text-dark-muted">({txn.risk_score}%)</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {getActionCell(txn)}
                      </td>
                      <td className="px-3 py-3.5">
                        {getStatusDisplay(txn.status, txn.required_action)}
                      </td>
                      <td className="px-3 py-3.5 text-right text-xs text-dark-muted">
                        {parseApiTimestamp(txn.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-20 text-center text-dark-muted flex flex-col items-center justify-center gap-3">
                {appliedSearch ? (
                  <>
                    <Search className="h-8 w-8 text-dark-border" />
                    <p className="text-sm">No transactions match "{appliedSearch}".</p>
                    <p className="text-xs text-dark-muted">Try a full transaction ID or customer account ID.</p>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-8 w-8 animate-pulse text-dark-border" />
                    <p className="text-sm">No transaction events recorded yet.</p>
                    <p className="text-xs text-dark-muted">Simulate a transaction or capture a webhook to stream events here.</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Pagination footer */}
          <div className="px-4 py-3 border-t border-dark-border flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-dark-muted font-semibold">
              Showing <span className="text-dark-text">{total === 0 ? 0 : page * pageSize + 1}</span>–
              <span className="text-dark-text">{Math.min(total, page * pageSize + rows.length)}</span> of{" "}
              <span className="text-dark-text">{total.toLocaleString()}</span>
              {loadError && <span className="text-brand-danger ml-2">{loadError}</span>}
            </span>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-dark-muted font-semibold">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                  className="bg-dark-bg border border-dark-border text-dark-text text-xs rounded px-2 py-1 focus:border-guard-orange focus:outline-none"
                >
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || isLoading}
                  className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-text hover:border-guard-orange transition disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span className="text-xs text-dark-muted font-semibold whitespace-nowrap">
                  Page {page + 1} / {Math.max(1, Math.ceil(total / pageSize))}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(total / pageSize)) - 1, p + 1))}
                  disabled={page >= Math.max(1, Math.ceil(total / pageSize)) - 1 || isLoading}
                  className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-text hover:border-guard-orange transition disabled:opacity-40"
                  aria-label="Next page"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Insights Pane */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand h-fit">
          {selectedTxn ? (
            <div className="space-y-5">
              <div className="border-b border-dark-border pb-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-guard-orange font-bold uppercase tracking-wider block">Detailed Analysis</span>
                  <h3 className="text-base font-bold text-dark-text">{selectedTxn.transaction_id}</h3>
                </div>
                {selectedTxn.status === "SUSPENDED" ? (
                  <span className="bg-guard-orangeLight text-guard-orange border border-guard-orange/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <PauseCircle className="h-3.5 w-3.5" /> SUSPENDED
                  </span>
                ) : isAuthHold(selectedTxn) ? (
                  <span className="bg-brand-warning/10 text-brand-warning border border-brand-warning/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <Fingerprint className="h-3.5 w-3.5" /> AWAITING USER AUTH
                  </span>
                ) : selectedTxn.status === "PENDING" ? (
                  <span className="bg-brand-info/10 text-brand-info border border-brand-info/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> PENDING
                  </span>
                ) : selectedTxn.status === "BLOCKED" ? (
                  <span className="bg-brand-danger/10 text-brand-danger border border-gray-200 dark:border-dark-border rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" /> FRAUD BLOCK
                  </span>
                ) : (
                  <span className="bg-brand-success/10 text-brand-success border border-gray-200 dark:border-dark-border rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" /> PASS
                  </span>
                )}
              </div>

              {/* Suspended/Pending: admin resolve panel, analyst suspend action,
                  or the customer-auth hold (MEDIUM 40-45) */}
              {(selectedTxn.status === "SUSPENDED" || selectedTxn.status === "PENDING") && (
                isAuthHold(selectedTxn) ? (
                  <div className="bg-brand-warning/10 border border-brand-warning/30 rounded-lg p-4 space-y-3">
                    <p className="text-xs text-brand-warning font-semibold leading-relaxed flex items-start gap-1.5">
                      <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        This medium-risk transaction (40-45%) is awaiting the customer's
                        authentication (OTP / biometric). Analysts cannot flag it. If it is not
                        authenticated within 15 minutes, the system blocks it automatically.
                      </span>
                    </p>
                    <button
                      disabled={authingId === selectedTxn.transaction_id}
                      onClick={() => handleAuthenticate(selectedTxn.transaction_id)}
                      className="w-full bg-brand-warning text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-warning/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {authingId === selectedTxn.transaction_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
                      {authingId === selectedTxn.transaction_id ? "Authenticating..." : "Simulate Customer Authentication"}
                    </button>
                    {isAdmin && (
                      <div className="flex gap-2 pt-1 border-t border-brand-warning/20">
                        <button
                          disabled={resolvingId === selectedTxn.transaction_id}
                          onClick={() => handleResolve(selectedTxn.transaction_id, "APPROVED")}
                          className="flex-1 bg-brand-success text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-success/90 transition disabled:opacity-50"
                        >
                          Approve (override)
                        </button>
                        <button
                          disabled={resolvingId === selectedTxn.transaction_id}
                          onClick={() => handleResolve(selectedTxn.transaction_id, "BLOCKED")}
                          className="flex-1 bg-brand-danger text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-danger/90 transition disabled:opacity-50"
                        >
                          Block (override)
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-guard-orangeLight border border-guard-orange/30 rounded-lg p-4 space-y-3">
                    <p className="text-xs text-guard-orange font-semibold leading-relaxed">
                      {selectedTxn.status === "PENDING"
                        ? "This transaction is medium risk and awaiting action. An analyst can flag it for review, or an admin can resolve it directly."
                        : "This transaction is held pending review. Funds will not move until an admin approves or blocks it."}
                    </p>
                    {isAdmin ? (
                      <div className="flex gap-2">
                        <button
                          disabled={resolvingId === selectedTxn.transaction_id}
                          onClick={() => handleResolve(selectedTxn.transaction_id, "APPROVED")}
                          className="flex-1 bg-brand-success text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-success/90 transition disabled:opacity-50"
                        >
                          Approve Transaction
                        </button>
                        <button
                          disabled={resolvingId === selectedTxn.transaction_id}
                          onClick={() => handleResolve(selectedTxn.transaction_id, "BLOCKED")}
                          className="flex-1 bg-brand-danger text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-danger/90 transition disabled:opacity-50"
                        >
                          Block Transaction
                        </button>
                      </div>
                    ) : selectedTxn.status === "PENDING" ? (
                      <button
                        disabled={claimingId === selectedTxn.transaction_id}
                        onClick={() => handleSuspend(selectedTxn.transaction_id)}
                        className="w-full bg-guard-orange text-white text-xs font-bold py-2 rounded-lg hover:bg-guard-orange/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {claimingId === selectedTxn.transaction_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                        {claimingId === selectedTxn.transaction_id ? "Suspending..." : "Suspend Transaction"}
                      </button>
                    ) : (
                      <p className="text-[11px] text-guard-orange/80 font-medium italic">
                        Only an admin account can resolve this. Sign in with an admin email to take action.
                      </p>
                    )}
                  </div>
                )
              )}

              {selectedTxn.claimed_by && (
                <div className="text-[11px] text-guard-orange bg-guard-orangeLight border border-guard-orange/30 rounded-lg px-3 py-2 flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Flagged by <span className="font-semibold">{selectedTxn.claimed_by}</span>
                    {selectedTxn.claimed_at && (
                      <> at {parseApiTimestamp(selectedTxn.claimed_at).toLocaleString()}</>
                    )}
                  </span>
                </div>
              )}

              {selectedTxn.resolved_by && (
                <div className="text-[11px] text-dark-muted bg-gray-50 dark:bg-white/5 border border-dark-border rounded-lg px-3 py-2">
                  Resolved by <span className="font-semibold text-dark-text">{selectedTxn.resolved_by}</span>
                  {selectedTxn.resolved_at && (
                    <> at {parseApiTimestamp(selectedTxn.resolved_at).toLocaleString()}</>
                  )}
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50/50 dark:bg-white/5 border border-dark-border p-3 rounded-lg">
                  <span className="text-[10px] text-dark-muted block uppercase">Amount (NGN)</span>
                  <span className="text-lg font-bold text-dark-text">₦{selectedTxn.amount.toLocaleString('en-NG')}</span>
                </div>
                <div className="bg-gray-50/50 dark:bg-white/5 border border-dark-border p-3 rounded-lg">
                  <span className="text-[10px] text-dark-muted block uppercase">Risk Probability</span>
                  <span className="text-lg font-bold text-dark-text">
                    {selectedTxn.fraud_probability !== null ? `${(selectedTxn.fraud_probability * 100).toFixed(1)}%` : "0.0%"}
                  </span>
                </div>
              </div>

              {/* Context info */}
              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 text-xs">
                  <UserCheck className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">User Account</span>
                    <span className="text-dark-text">{selectedTxn.user_id}</span>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 text-xs">
                  <Shield className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Beneficiary Account Address</span>
                    <span className="text-dark-text">{selectedTxn.beneficiary_id}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <Activity className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Payment Channel / Method</span>
                    <span className="text-dark-text font-bold uppercase text-[10px] bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-dark-border px-2 py-0.5 rounded tracking-wider">
                      {selectedTxn.payment_method || "USSD"}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <Tablet className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Device fingerprint</span>
                    <span className="text-dark-text truncate max-w-[200px] block">{selectedTxn.device_id}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <MapPin className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Geo location coordinates</span>
                    <span className="text-dark-text text-xs">
                      {selectedTxn.location_latitude.toFixed(4)}, {selectedTxn.location_longitude.toFixed(4)}
                    </span>
                    <span className={`block text-xs font-semibold ${isInNigeria(selectedTxn.location_latitude, selectedTxn.location_longitude) ? "text-guard-orange" : "text-red-400"}`}>
                      {formatPlace(selectedTxn.location_latitude, selectedTxn.location_longitude)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Triggered rules explanation */}
              <div className="border-t border-dark-border pt-4">
                <h4 className="text-xs font-bold uppercase text-dark-text mb-2.5">Rule Violations Explanations</h4>
                <div className="space-y-2">
                  {selectedTxn.triggered_rules && selectedTxn.triggered_rules.length > 0 ? (
                    selectedTxn.triggered_rules.map((rule, idx) => (
                      <div 
                        key={idx} 
                        className={`text-xs border rounded-lg p-2.5 ${
                          rule.severity === "CRITICAL"
                            ? "bg-brand-danger/5 border-brand-danger/20 text-brand-danger"
                            : rule.severity === "WARNING"
                            ? "bg-brand-warning/5 border-brand-warning/20 text-brand-warning"
                            : "bg-brand-info/5 border-brand-info/20 text-brand-info"
                        }`}
                      >
                        <div className="font-bold flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {rule.rule_name}
                        </div>
                        <p className="mt-0.5 text-dark-text leading-normal">{rule.message}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-brand-success bg-brand-success/5 border border-brand-success/20 rounded-lg p-3 text-center font-medium">
                      No rules triggered. Core features represent normal baseline behavior.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center text-dark-muted text-xs flex flex-col items-center justify-center gap-2">
              <Activity className="h-8 w-8 text-dark-border" />
              Click any transaction on the left list to explore deep risk signals and ML feature analytics.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Transaction } from "../types";
import {
  Inbox, ShieldCheck, ShieldAlert, Flag, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, Ban, Clock, Search, X, PauseCircle, AlertCircle, Activity,
  MapPin, Tablet, UserCheck, Shield, User
} from "lucide-react";
import { getStoredUser, getTransactionsPage, resolveTransaction, getTransactionById } from "../services/api";
import { useToast } from "../context/ToastContext";
import { parseApiTimestamp } from "../utils/time";

const POLL_MS = 10000;

/**
 * Admin Review Queue.
 *
 * Pending  = transactions an analyst suspended (flagged) - they carry
 *            claimed_by/claimed_at (the analyst stamp) and wait for an admin.
 * Completed = every resolved transaction (APPROVED or BLOCKED), stamped with
 *            resolved_by/resolved_at (the admin stamp) plus the analyst who
 *            originally flagged it, if any.
 *
 * Both counters are server-side totals (?status=...&limit=1) refreshed on a
 * 10s poll, so the pending counter climbs on its own as analysts flag work.
 */
export const ReviewQueue: React.FC = () => {
  const { showToast } = useToast();
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === "admin";

  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [completedTotal, setCompletedTotal] = useState(0);
  // listTotal = the CURRENT tab's list size, honoring any applied search, so
  // pagination/footer track the filtered rows while the header counters stay
  // global (real pending/completed workload numbers).
  const [listTotal, setListTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Row click -> detail modal (same analysis as the Live Monitor pane).
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);

  // Bump animation on the big counter when pending work INCREASES.
  const [counterBump, setCounterBump] = useState(false);
  const prevPending = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setFetching(true);
    setLoadError(null);
    try {
      const [counts, pageData] = await Promise.all([
        Promise.all([
          getTransactionsPage({ status: "SUSPENDED", limit: 1 }),
          getTransactionsPage({ status: "RESOLVED", limit: 1 }),
        ]),
        getTransactionsPage({
          status: tab === "pending" ? "SUSPENDED" : "RESOLVED",
          search: appliedSearch,
          limit: pageSize,
          offset: page * pageSize,
          // Newest first on BOTH tabs - the freshest work is always on top.
          sort: "desc",
        }),
      ]);
      const newPending = counts[0].total;
      if (prevPending.current !== null && newPending > prevPending.current) {
        setCounterBump(true);
        window.setTimeout(() => setCounterBump(false), 500);
      }
      prevPending.current = newPending;
      setPendingTotal(newPending);
      setCompletedTotal(counts[1].total);
      setRows(pageData.items);
      setListTotal(pageData.total);
      // Snap back if the page emptied (e.g. last pending row was resolved,
      // or a search narrowed the results below the current page).
      if (pageData.items.length === 0 && pageData.total > 0 && page > 0) {
        setPage(Math.max(0, Math.ceil(pageData.total / pageSize) - 1));
      }
    } catch (e) {
      console.error("Review queue refresh failed:", e);
      setLoadError("Could not load the review queue. Retrying shortly…");
    } finally {
      setFetching(false);
    }
  }, [isAdmin, tab, page, pageSize, appliedSearch]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(searchInput.trim());
    setPage(0);
  };

  const clearSearch = () => {
    setSearchInput("");
    setAppliedSearch("");
    setPage(0);
  };

  // Open the detail modal: show the clicked row instantly, then re-fetch the
  // single record so stamps/rules are fresh (another admin may have just
  // resolved it while we were looking at the list).
  const openDetail = (txn: Transaction) => {
    setSelectedTxn(txn);
    getTransactionById(txn.transaction_id)
      .then((fresh) => setSelectedTxn(fresh))
      .catch(() => { /* keep the row data if the fetch fails */ });
  };

  // Escape closes the modal.
  useEffect(() => {
    if (!selectedTxn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedTxn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTxn]);

  const handleResolve = async (txnId: string, decision: "APPROVED" | "BLOCKED") => {
    setResolvingId(txnId);
    try {
      const updated = await resolveTransaction(txnId, decision);
      // Keep an open modal in sync with the fresh server row.
      if (selectedTxn?.transaction_id === txnId) {
        setSelectedTxn({ ...selectedTxn, ...updated });
      }
      showToast(
        "success",
        decision === "APPROVED" ? "Transaction approved" : "Transaction blocked",
        `${txnId} moved to Completed with your stamp.`
      );
      await refresh();
    } catch (e: any) {
      console.error("Resolve failed:", e);
      const detail = e?.response?.data?.detail;
      showToast("danger", "Action failed", typeof detail === "string" ? detail : "Could not update the transaction. Please try again.");
    } finally {
      setResolvingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-xl p-10 text-center">
        <ShieldAlert className="h-8 w-8 text-guard-orange mx-auto" />
        <h2 className="text-lg font-bold text-dark-text mt-3">Admins only</h2>
        <p className="text-xs text-dark-muted mt-1">
          The Review Queue is restricted to admin accounts.
        </p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const total = listTotal;
  const fromRow = total === 0 ? 0 : page * pageSize + 1;
  const toRow = Math.min(total, page * pageSize + rows.length);

  const getRiskBadge = (level: string | null) => {
    switch (level) {
      case "LOW":
        return <span className="bg-brand-success/15 text-brand-success px-2 py-0.5 rounded text-xs font-semibold">LOW</span>;
      case "MEDIUM":
        return <span className="bg-brand-warning/15 text-brand-warning px-2 py-0.5 rounded text-xs font-semibold">MEDIUM</span>;
      case "HIGH":
        return <span className="bg-brand-danger/15 text-brand-danger px-2 py-0.5 rounded text-xs font-semibold">HIGH</span>;
      default:
        return <span className="bg-dark-border text-dark-muted px-2 py-0.5 rounded text-xs font-semibold">N/A</span>;
    }
  };

  const fmtTime = (iso: string | null | undefined) =>
    iso ? parseApiTimestamp(iso).toLocaleString("en-NG", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    }) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-dark-text">Admin Review Queue</h1>
        <p className="text-dark-muted mt-1">Work routed to you by analysts, and every decision you've stamped</p>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-dark-card border border-guard-orange/40 rounded-xl p-5 shadow-glow-brand flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-guard-orange">Pending Review</p>
            <h3
              className={`text-4xl font-extrabold text-dark-text mt-1 transition-transform duration-300 ${counterBump ? "scale-110" : ""}`}
            >
              {pendingTotal}
            </h3>
            <p className="text-xs text-dark-muted mt-1">Flagged by analysts, awaiting your decision</p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-guard-orangeLight border border-guard-orange/30 flex items-center justify-center">
            <Inbox className={`h-6 w-6 text-guard-orange ${counterBump ? "animate-ping" : ""}`} />
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-success">Completed</p>
            <h3 className="text-4xl font-extrabold text-dark-text mt-1">{completedTotal}</h3>
            <p className="text-xs text-dark-muted mt-1">Approved or blocked, stamped and audited</p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-brand-success/10 border border-brand-success/30 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-brand-success" />
          </div>
        </div>
      </div>

      {/* Tabs + live indicator */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => { setTab("pending"); setPage(0); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              tab === "pending"
                ? "bg-guard-orange text-white"
                : "bg-dark-card border border-dark-border text-dark-muted hover:text-dark-text"
            }`}
          >
            <Flag className="h-3.5 w-3.5" /> Pending ({pendingTotal})
          </button>
          <button
            onClick={() => { setTab("completed"); setPage(0); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              tab === "completed"
                ? "bg-brand-success text-white"
                : "bg-dark-card border border-dark-border text-dark-muted hover:text-dark-text"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Completed ({completedTotal})
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-dark-muted font-semibold">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-success opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-success"></span>
          </span>
          Live · refreshes every {POLL_MS / 1000}s
        </div>
      </div>

      {/* Search: by Transaction ID or User Account, applied via the button */}
      <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dark-muted pointer-events-none" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by Transaction ID or User Account…"
            aria-label="Search by transaction ID or user account"
            className="w-full bg-dark-card border border-dark-border text-dark-text text-sm rounded-lg pl-9 pr-3 py-2 focus:border-guard-orange focus:outline-none placeholder:text-dark-muted"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-guard-orange text-white border border-guard-orange hover:bg-guard-orange/90 transition"
        >
          <Search className="h-3.5 w-3.5" /> Search
        </button>
        {appliedSearch && (
          <button
            type="button"
            onClick={clearSearch}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-dark-card border border-dark-border text-dark-muted hover:text-dark-text hover:border-guard-orange transition"
          >
            <X className="h-3.5 w-3.5" /> Clear
            <span className="font-mono text-dark-text">"{appliedSearch}"</span>
          </button>
        )}
      </form>

      {/* Table */}
      <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden">
        <div className="overflow-x-auto">
          {rows.length > 0 || fetching ? (
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100/70 dark:bg-dark-card text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                {tab === "pending" ? (
                  <tr>
                    <th className="px-3 py-3">Received</th>
                    <th className="px-3 py-3">Transaction ID</th>
                    <th className="px-3 py-3">User Account</th>
                    <th className="px-3 py-3">Amount</th>
                    <th className="px-3 py-3 text-center">Risk</th>
                    <th className="px-3 py-3">Flagged By (Analyst)</th>
                    <th className="px-3 py-3 text-right">Your Decision</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-3 py-3">Decision</th>
                    <th className="px-3 py-3">Transaction ID</th>
                    <th className="px-3 py-3">Amount</th>
                    <th className="px-3 py-3 text-center">Risk</th>
                    <th className="px-3 py-3">Flagged By (Analyst)</th>
                    <th className="px-3 py-3">Admin Stamp</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-dark-border text-sm">
                {fetching && rows.length === 0 && (
                  <tr>
                    <td colSpan={tab === "pending" ? 7 : 6} className="px-3 py-12 text-center">
                      <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
                      <p className="text-xs text-dark-muted mt-2">Loading review queue…</p>
                    </td>
                  </tr>
                )}

                {/* PENDING ROWS */}
                {tab === "pending" && rows.map((row) => (
                  <tr
                    key={row.transaction_id}
                    onClick={() => openDetail(row)}
                    className="hover:bg-dark-border/10 transition cursor-pointer"
                  >
                    <td className="px-3 py-3.5 text-xs text-dark-muted font-semibold whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {fmtTime(row.claimed_at) || fmtTime(row.created_at)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs font-semibold text-dark-text">{row.transaction_id}</td>
                    <td className="px-3 py-3.5 text-dark-text font-medium">{row.user_id}</td>
                    <td className="px-3 py-3.5 text-dark-text font-bold">₦{row.amount.toLocaleString("en-NG")}</td>
                    <td className="px-3 py-3.5 text-center">{getRiskBadge(row.risk_level)}</td>
                    <td className="px-3 py-3.5">
                      <span className="text-dark-text font-semibold text-xs block">{row.claimed_by || "—"}</span>
                      {row.claimed_at && (
                        <span className="text-[10px] text-dark-muted">{fmtTime(row.claimed_at)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                          disabled={resolvingId !== null}
                          onClick={() => handleResolve(row.transaction_id, "APPROVED")}
                          className="bg-brand-success text-white text-xs font-bold py-1.5 px-3 rounded-lg hover:bg-brand-success/90 transition disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {resolvingId === row.transaction_id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Approve
                        </button>
                        <button
                          disabled={resolvingId !== null}
                          onClick={() => handleResolve(row.transaction_id, "BLOCKED")}
                          className="bg-brand-danger text-white text-xs font-bold py-1.5 px-3 rounded-lg hover:bg-brand-danger/90 transition disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Block
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {/* COMPLETED ROWS */}
                {tab === "completed" && rows.map((row) => (
                  <tr
                    key={row.transaction_id}
                    onClick={() => openDetail(row)}
                    className="hover:bg-dark-border/10 transition cursor-pointer"
                  >
                    <td className="px-3 py-3.5">
                      {row.status === "BLOCKED" ? (
                        <span className="text-brand-danger font-bold text-xs flex items-center gap-1">
                          <ShieldAlert className="h-3.5 w-3.5" /> BLOCKED
                        </span>
                      ) : (
                        <span className="text-brand-success font-bold text-xs flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" /> APPROVED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs font-semibold text-dark-text">{row.transaction_id}</td>
                    <td className="px-3 py-3.5 text-dark-text font-bold">₦{row.amount.toLocaleString("en-NG")}</td>
                    <td className="px-3 py-3.5 text-center">{getRiskBadge(row.risk_level)}</td>
                    <td className="px-3 py-3.5">
                      {row.claimed_by ? (
                        <>
                          <span className="text-dark-text font-semibold text-xs block">{row.claimed_by}</span>
                          {row.claimed_at && <span className="text-[10px] text-dark-muted">{fmtTime(row.claimed_at)}</span>}
                        </>
                      ) : (
                        <span className="text-dark-muted text-xs">— resolved directly</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-guard-orange font-semibold text-xs block">{row.resolved_by || "—"}</span>
                      {row.resolved_at && <span className="text-[10px] text-dark-muted">{fmtTime(row.resolved_at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-20 text-center text-dark-muted text-xs">
              {loadError ? (
                <span className="text-brand-danger">{loadError}</span>
              ) : appliedSearch ? (
                <>
                  <Search className="h-8 w-8 mx-auto mb-3" />
                  No transactions match "{appliedSearch}".
                </>
              ) : tab === "pending" ? (
                <>
                  <CheckCircle2 className="h-8 w-8 text-brand-success mx-auto mb-3" />
                  No transactions are waiting for review. New analyst flags appear here automatically.
                </>
              ) : (
                <>
                  <ShieldCheck className="h-8 w-8 mx-auto mb-3" />
                  No completed reviews yet. Decisions you make on pending work land here with both stamps.
                </>
              )}
            </div>
          )}
        </div>

        {/* Pagination footer */}
        <div className="px-4 py-3 border-t border-dark-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-dark-muted font-semibold">
            Showing <span className="text-dark-text">{fromRow}</span>–<span className="text-dark-text">{toRow}</span> of{" "}
            <span className="text-dark-text">{total.toLocaleString()}</span>
            {appliedSearch && <span className="text-dark-muted"> matching "{appliedSearch}"</span>}
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
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || fetching}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-text hover:border-guard-orange transition disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <span className="text-xs text-dark-muted font-mono font-semibold whitespace-nowrap">
                Page {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || fetching}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-text hover:border-guard-orange transition disabled:opacity-40"
                aria-label="Next page"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction detail modal - same analysis as the Live Monitor pane */}
      {selectedTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedTxn(null)}
          />
          <div className="relative bg-dark-card border border-dark-border rounded-xl shadow-glow-brand w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <button
              onClick={() => setSelectedTxn(null)}
              aria-label="Close details"
              className="absolute top-4 right-4 text-dark-muted hover:text-dark-text transition p-1 rounded-lg hover:bg-dark-border/30"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-5">
              {/* Header + status pill */}
              <div className="border-b border-dark-border pb-4 pr-8">
                <span className="text-[10px] text-guard-orange font-bold uppercase tracking-wider block">Detailed Analysis</span>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <h3 className="text-base font-mono font-bold text-dark-text">{selectedTxn.transaction_id}</h3>
                  {selectedTxn.status === "SUSPENDED" ? (
                    <span className="bg-guard-orangeLight text-guard-orange border border-guard-orange/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                      <PauseCircle className="h-3.5 w-3.5" /> SUSPENDED
                    </span>
                  ) : selectedTxn.status === "PENDING" ? (
                    <span className="bg-brand-info/10 text-brand-info border border-brand-info/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" /> PENDING
                    </span>
                  ) : selectedTxn.status === "BLOCKED" ? (
                    <span className="bg-brand-danger/10 text-brand-danger border border-dark-border rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" /> FRAUD BLOCK
                    </span>
                  ) : (
                    <span className="bg-brand-success/10 text-brand-success border border-dark-border rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" /> PASS
                    </span>
                  )}
                  {getRiskBadge(selectedTxn.risk_level)}
                </div>
              </div>

              {/* Resolve panel for live (PENDING/SUSPENDED) work */}
              {(selectedTxn.status === "SUSPENDED" || selectedTxn.status === "PENDING") && (
                <div className="bg-guard-orangeLight border border-guard-orange/30 rounded-lg p-4 space-y-3">
                  <p className="text-xs text-guard-orange font-semibold leading-relaxed">
                    {selectedTxn.status === "PENDING"
                      ? "This transaction is medium risk and awaiting action. An analyst can flag it for review, or you can resolve it directly."
                      : "This transaction is held pending review. Funds will not move until you approve or block it."}
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={resolvingId === selectedTxn.transaction_id}
                      onClick={() => handleResolve(selectedTxn.transaction_id, "APPROVED")}
                      className="flex-1 bg-brand-success text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-success/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {resolvingId === selectedTxn.transaction_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Approve Transaction
                    </button>
                    <button
                      disabled={resolvingId === selectedTxn.transaction_id}
                      onClick={() => handleResolve(selectedTxn.transaction_id, "BLOCKED")}
                      className="flex-1 bg-brand-danger text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-danger/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {resolvingId === selectedTxn.transaction_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      Block Transaction
                    </button>
                  </div>
                </div>
              )}

              {/* Analyst stamp */}
              {selectedTxn.claimed_by && (
                <div className="text-[11px] text-guard-orange bg-guard-orangeLight border border-guard-orange/30 rounded-lg px-3 py-2 flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Flagged by <span className="font-semibold">{selectedTxn.claimed_by}</span>
                    {selectedTxn.claimed_at && (
                      <> at {fmtTime(selectedTxn.claimed_at)}</>
                    )}
                  </span>
                </div>
              )}

              {/* Admin stamp */}
              {selectedTxn.resolved_by && (
                <div className="text-[11px] text-dark-muted bg-gray-50 dark:bg-white/5 border border-dark-border rounded-lg px-3 py-2">
                  Resolved by <span className="font-semibold text-dark-text">{selectedTxn.resolved_by}</span>
                  {selectedTxn.resolved_at && (
                    <> at {fmtTime(selectedTxn.resolved_at)}</>
                  )}
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50/50 dark:bg-white/5 border border-dark-border p-3 rounded-lg">
                  <span className="text-[10px] text-dark-muted block uppercase">Amount (NGN)</span>
                  <span className="text-lg font-bold text-dark-text">₦{selectedTxn.amount.toLocaleString("en-NG")}</span>
                </div>
                <div className="bg-gray-50/50 dark:bg-white/5 border border-dark-border p-3 rounded-lg">
                  <span className="text-[10px] text-dark-muted block uppercase">Risk Probability</span>
                  <span className="text-lg font-bold text-dark-text">
                    {selectedTxn.fraud_probability !== null ? `${(selectedTxn.fraud_probability * 100).toFixed(1)}%` : "0.0%"}
                  </span>
                </div>
              </div>

              {/* Context info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-start gap-3 text-xs">
                  <UserCheck className="h-4 w-4 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">User Account</span>
                    <span className="text-dark-text font-mono">{selectedTxn.user_id}</span>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-xs">
                  <Shield className="h-4 w-4 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Beneficiary Account Address</span>
                    <span className="text-dark-text font-mono">{selectedTxn.beneficiary_id}</span>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-xs">
                  <Activity className="h-4 w-4 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Payment Channel / Method</span>
                    <span className="text-dark-text font-bold uppercase text-[10px] bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-dark-border px-2 py-0.5 rounded tracking-wider inline-block mt-0.5">
                      {selectedTxn.payment_method || "USSD"}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-xs">
                  <Tablet className="h-4 w-4 text-guard-orange shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="text-dark-muted block font-semibold">Device fingerprint</span>
                    <span className="text-dark-text font-mono truncate block">{selectedTxn.device_id}</span>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-xs sm:col-span-2">
                  <MapPin className="h-4 w-4 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Geo location coordinates</span>
                    <span className="text-dark-text font-mono text-xs">
                      {selectedTxn.location_latitude.toFixed(4)}, {selectedTxn.location_longitude.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rule violations explanation */}
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
          </div>
        </div>
      )}
    </div>
  );
};

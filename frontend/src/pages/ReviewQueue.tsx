import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Transaction } from "../types";
import {
  Inbox, ShieldCheck, ShieldAlert, Flag, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, Ban, Clock
} from "lucide-react";
import { getStoredUser, getTransactionsPage, resolveTransaction } from "../services/api";
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
  const [rows, setRows] = useState<Transaction[]>([]);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

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
          limit: pageSize,
          offset: page * pageSize,
          sort: tab === "pending" ? "asc" : "desc",
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
      // Snap back if the page emptied (e.g. last pending row was resolved).
      if (pageData.items.length === 0 && pageData.total > 0 && page > 0) {
        setPage(Math.max(0, Math.ceil(pageData.total / pageSize) - 1));
      }
    } catch (e) {
      console.error("Review queue refresh failed:", e);
      setLoadError("Could not load the review queue. Retrying shortly…");
    } finally {
      setFetching(false);
    }
  }, [isAdmin, tab, page, pageSize]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleResolve = async (txnId: string, decision: "APPROVED" | "BLOCKED") => {
    setResolvingId(txnId);
    try {
      await resolveTransaction(txnId, decision);
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

  const totalPages = Math.max(1, Math.ceil((tab === "pending" ? pendingTotal : completedTotal) / pageSize));
  const total = tab === "pending" ? pendingTotal : completedTotal;
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
                  <tr key={row.transaction_id} className="hover:bg-dark-border/10 transition">
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
                      <div className="flex gap-2 justify-end">
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
                  <tr key={row.transaction_id} className="hover:bg-dark-border/10 transition">
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
    </div>
  );
};

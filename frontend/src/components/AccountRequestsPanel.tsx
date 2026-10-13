import React, { useCallback, useEffect, useState } from "react";
import type { AccountSuspendRequest, SuspendRequestSla, BlockedAccount } from "../types";
import {
  Ban, X, Clock, Loader2, ShieldAlert, ShieldCheck,
  ChevronLeft, ChevronRight, UserCheck, Undo2, Inbox,
} from "lucide-react";
import {
  getSuspendRequests, getSuspendRequestSla, reviewSuspendRequest,
  getBlockedAccounts, unblockAccount,
} from "../services/api";
import { useToast } from "../context/ToastContext";
import { parseApiTimestamp } from "../utils/time";
import { SlaPieChart } from "./SlaPieChart";
import { TransactionDetailsModal } from "./TransactionDetailsModal";

const POLL_MS = 10000;

type ReqFilter = "PENDING" | "APPROVED" | "DECLINED";

/**
 * Admin panel for the account-suspension workflow. Analysts raise a request
 * against a sender account (with a recommendation note) after a HIGH-risk
 * transaction was auto-BLOCKED; the admin approves (account joins the
 * blocklist) or declines. Surfaces the SLA pie chart on top.
 */
export const AccountRequestsPanel: React.FC = () => {
  const { showToast } = useToast();
  const [view, setView] = useState<"requests" | "blocklist">("requests");
  const [filter, setFilter] = useState<ReqFilter>("PENDING");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [rows, setRows] = useState<AccountSuspendRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [sla, setSla] = useState<SuspendRequestSla | null>(null);
  const [blocked, setBlocked] = useState<BlockedAccount[]>([]);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [detailTxnId, setDetailTxnId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setFetching(true);
    setLoadError(null);
    try {
      const [pageData, slaData] = await Promise.all([
        getSuspendRequests({ status: filter, limit: pageSize, offset: page * pageSize }),
        getSuspendRequestSla(false),
      ]);
      setRows(pageData.items);
      setTotal(pageData.total);
      setSla(slaData);
      if (pageData.items.length === 0 && pageData.total > 0 && page > 0) {
        setPage(Math.max(0, Math.ceil(pageData.total / pageSize) - 1));
      }
    } catch (e) {
      console.error("Account requests refresh failed:", e);
      setLoadError("Could not load account requests. Retrying shortly…");
    } finally {
      setFetching(false);
    }
  }, [filter, page, pageSize]);

  const loadBlocklist = useCallback(async () => {
    setFetching(true);
    setLoadError(null);
    try {
      setBlocked(await getBlockedAccounts());
    } catch (e) {
      console.error("Blocklist load failed:", e);
      setLoadError("Could not load the account blocklist.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (view === "requests") {
      refresh();
      const id = window.setInterval(refresh, POLL_MS);
      return () => window.clearInterval(id);
    }
    loadBlocklist();
  }, [view, refresh, loadBlocklist]);

  const decide = async (request: AccountSuspendRequest, decision: "APPROVED" | "DECLINED") => {
    setBusyId(request.request_id);
    try {
      const updated = await reviewSuspendRequest(request.request_id, decision);
      showToast(
        decision === "APPROVED" ? "success" : "danger",
        decision === "APPROVED" ? "Account suspended" : "Request declined",
        decision === "APPROVED"
          ? `${updated.account_id} was added to the account blocklist.`
          : `${request.account_id} was left unblocked.`
      );
      await refresh();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      showToast("danger", "Action failed", typeof detail === "string" ? detail : "Could not review this request.");
    } finally {
      setBusyId(null);
    }
  };

  const handleUnblock = async (accountId: string) => {
    setUnblockingId(accountId);
    try {
      await unblockAccount(accountId);
      showToast("success", "Account unblocked", `${accountId} was removed from the blocklist.`);
      await loadBlocklist();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      showToast("danger", "Unblock failed", typeof detail === "string" ? detail : "Could not unblock this account.");
    } finally {
      setUnblockingId(null);
    }
  };

  const fmtTime = (iso: string | null | undefined) =>
    iso ? parseApiTimestamp(iso).toLocaleString("en-NG", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }) : "—";

  const fmtMins = (mins: number) => {
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  // Ageing of a request since it was raised (fresh <30m, due 30-120m, >2h breach).
  const getAging = (row: AccountSuspendRequest) => {
    let mins = 0;
    try {
      mins = Math.max(0, (Date.now() - parseApiTimestamp(row.requested_at).getTime()) / 60000);
    } catch { /* treat as fresh */ }
    if (mins >= 120) return { label: `${fmtMins(mins)} waiting`, cls: "text-brand-danger bg-brand-danger/10 border-brand-danger/30" };
    if (mins >= 30) return { label: `${fmtMins(mins)} waiting`, cls: "text-brand-warning bg-brand-warning/10 border-brand-warning/30" };
    return { label: "Fresh", cls: "text-brand-success bg-brand-success/10 border-brand-success/30" };
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const statusPill = (status: string) => {
    if (status === "APPROVED") return <span className="text-brand-success font-bold text-xs flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> APPROVED</span>;
    if (status === "DECLINED") return <span className="text-dark-muted font-bold text-xs flex items-center gap-1"><X className="h-3.5 w-3.5" /> DECLINED</span>;
    return <span className="text-brand-warning font-bold text-xs flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> PENDING</span>;
  };

  return (
    <div className="space-y-5">
      <SlaPieChart sla={sla} loading={fetching && !sla} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => { setView("requests"); setPage(0); }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            view === "requests" ? "bg-guard-orange text-white" : "bg-dark-card border border-dark-border text-dark-muted hover:text-dark-text"
          }`}
        >
          <Inbox className="h-3.5 w-3.5" /> Suspension Requests
        </button>
        <button
          onClick={() => setView("blocklist")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            view === "blocklist" ? "bg-brand-danger text-white" : "bg-dark-card border border-dark-border text-dark-muted hover:text-dark-text"
          }`}
        >
          <Ban className="h-3.5 w-3.5" /> Blocked Accounts
        </button>
      </div>

      {view === "requests" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(["PENDING", "APPROVED", "DECLINED"] as ReqFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  filter === f
                    ? f === "PENDING" ? "bg-brand-warning/20 text-brand-warning border border-brand-warning/40"
                      : "bg-dark-border text-dark-text"
                    : "bg-dark-card border border-dark-border text-dark-muted hover:text-dark-text"
                }`}
              >
                {f === "PENDING" ? "Pending" : f === "APPROVED" ? "Approved" : "Declined"}
              </button>
            ))}
          </div>

          <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden">
            <div className="overflow-x-auto">
              {rows.length > 0 || fetching ? (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100/70 dark:bg-dark-card text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                    <tr>
                      <th className="px-3 py-3">Raised</th>
                      <th className="px-3 py-3">Account</th>
                      <th className="px-3 py-3">Source Transaction</th>
                      <th className="px-3 py-3">Requested By</th>
                      <th className="px-3 py-3">Recommendation</th>
                      <th className="px-3 py-3 text-right">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-dark-border text-sm">
                    {fetching && rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-12 text-center">
                          <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
                          <p className="text-xs text-dark-muted mt-2">Loading requests…</p>
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => {
                      const aging = getAging(row);
                      return (
                        <tr
                          key={row.request_id}
                          onClick={() => row.source_txn_id && setDetailTxnId(row.source_txn_id)}
                          className={`hover:bg-dark-border/10 transition ${row.source_txn_id ? "cursor-pointer" : ""}`}
                        >
                          <td className="px-3 py-3.5 text-xs text-dark-muted font-semibold whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5" />
                              {fmtTime(row.requested_at)}
                            </span>
                            {row.status === "PENDING" && (
                              <span className={`inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${aging.cls}`}>
                                {aging.label}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3.5">
                            <span className="text-dark-text font-semibold font-mono text-xs flex items-center gap-1.5">
                              <UserCheck className="h-3.5 w-3.5 text-guard-orange" /> {row.account_id}
                            </span>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className="text-dark-text font-mono text-xs block">{row.source_txn_id || "—"}</span>
                            {row.source_risk_level && (
                              <span className="text-[10px] font-semibold text-dark-muted">
                                {row.source_risk_level}
                                {row.source_risk_score !== null && row.source_risk_score !== undefined ? ` · ${row.source_risk_score}%` : ""}
                                {row.source_amount ? ` · ₦${row.source_amount.toLocaleString("en-NG")}` : ""}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 text-dark-text text-xs font-medium">{row.requested_by}</td>
                          <td className="px-3 py-3.5 max-w-[260px]">
                            <span className="text-dark-text text-xs leading-snug block whitespace-pre-wrap">
                              {row.note || <span className="text-dark-muted italic">No note provided</span>}
                            </span>
                          </td>
                          <td className="px-3 py-3.5">
                            {row.status === "PENDING" ? (
                              <div className="flex gap-2 justify-end">
                                <button
                                  disabled={busyId !== null}
                                  onClick={(e) => { e.stopPropagation(); decide(row, "APPROVED"); }}
                                  className="bg-brand-danger text-white text-xs font-bold py-1.5 px-3 rounded-lg hover:bg-brand-danger/90 transition disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {busyId === row.request_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                                  Suspend
                                </button>
                                <button
                                  disabled={busyId !== null}
                                  onClick={(e) => { e.stopPropagation(); decide(row, "DECLINED"); }}
                                  className="bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text text-xs font-bold py-1.5 px-3 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  <X className="h-3.5 w-3.5" /> Decline
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                {statusPill(row.status)}
                                <span className="text-[10px] text-dark-muted">
                                  {row.reviewed_by || "—"} · {fmtTime(row.reviewed_at)}
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="py-20 text-center text-dark-muted text-xs">
                  {loadError ? (
                    <span className="text-brand-danger">{loadError}</span>
                  ) : (
                    <>
                      <ShieldCheck className="h-8 w-8 text-brand-success mx-auto mb-3" />
                      No {filter.toLowerCase()} suspension requests.
                    </>
                  )}
                </div>
              )}
            </div>

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
                    {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || fetching}
                    className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-text hover:border-guard-orange transition disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <span className="text-xs text-dark-muted font-semibold whitespace-nowrap">
                    Page {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1 || fetching}
                    className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-md bg-dark-bg border border-dark-border text-dark-text hover:border-guard-orange transition disabled:opacity-40"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden">
          {blocked.length > 0 || fetching ? (
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100/70 dark:bg-dark-card text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-3 py-3">Account</th>
                  <th className="px-3 py-3">Reason</th>
                  <th className="px-3 py-3">Source Transaction</th>
                  <th className="px-3 py-3">Approved By</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-dark-border text-sm">
                {blocked.map((acc) => (
                  <tr
                    key={acc.account_id}
                    onClick={() => acc.source_txn_id && setDetailTxnId(acc.source_txn_id)}
                    className={`hover:bg-dark-border/10 transition ${acc.source_txn_id ? "cursor-pointer" : ""}`}
                  >
                    <td className="px-3 py-3.5">
                      <span className="text-dark-text font-semibold font-mono text-xs flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5 text-brand-danger" /> {acc.account_id}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-dark-text text-xs max-w-[280px]">{acc.reason || "—"}</td>
                    <td className="px-3 py-3.5 text-dark-text font-mono text-xs">{acc.source_txn_id || "—"}</td>
                    <td className="px-3 py-3.5 text-xs">
                      <span className="text-guard-orange font-semibold block">{acc.blocked_by}</span>
                      <span className="text-[10px] text-dark-muted">{fmtTime(acc.blocked_at)}</span>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <button
                        disabled={unblockingId !== null}
                        onClick={(e) => { e.stopPropagation(); handleUnblock(acc.account_id); }}
                        className="inline-flex items-center gap-1.5 bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text text-xs font-bold py-1.5 px-3 rounded-lg transition disabled:opacity-50"
                      >
                        {unblockingId === acc.account_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-20 text-center text-dark-muted text-xs">
              {loadError ? <span className="text-brand-danger">{loadError}</span> : "No accounts are blocked."}
            </div>
          )}
        </div>
      )}

      <TransactionDetailsModal
        transactionId={detailTxnId}
        onClose={() => setDetailTxnId(null)}
        onResolved={view === "requests" ? refresh : loadBlocklist}
      />
    </div>
  );
};

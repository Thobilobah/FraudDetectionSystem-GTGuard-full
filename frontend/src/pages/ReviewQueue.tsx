import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Inbox, ShieldCheck, ShieldAlert, Loader2,
} from "lucide-react";
import { getStoredUser, getQueueMetrics, type QueueMetrics } from "../services/api";
import { AccountRequestsPanel } from "../components/AccountRequestsPanel";

const POLL_MS = 10000;

/**
 * Admin Review Queue - the analyst-requested account-suspension workflow.
 *
 * Pending  = account-suspension requests raised by analysts, awaiting the
 *            admin's decision (approve -> the account joins the blocklist,
 *            or decline).
 * Completed = every request the admin has decided (APPROVED or DECLINED),
 *            stamped with reviewed_by/reviewed_at.
 *
 * The counters are sourced from getQueueMetrics() (which now reads
 * account_suspend_requests) on a 10s poll, so the pending counter climbs on
 * its own as analysts raise new requests.
 */
export const ReviewQueue: React.FC = () => {
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === "admin";

  const [pendingTotal, setPendingTotal] = useState(0);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [fetching, setFetching] = useState(false);

  // Bump animation on the big counter when pending work INCREASES.
  const [counterBump, setCounterBump] = useState(false);
  const prevPending = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setFetching(true);
    try {
      const m = await getQueueMetrics();
      const newPending = m.pending;
      if (prevPending.current !== null && newPending > prevPending.current) {
        setCounterBump(true);
        window.setTimeout(() => setCounterBump(false), 500);
      }
      prevPending.current = newPending;
      setMetrics(m);
      setPendingTotal(newPending);
      setCompletedTotal(m.completed_total);
    } catch (e) {
      console.error("Review queue refresh failed:", e);
    } finally {
      setFetching(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const fmtMins = (mins: number) => {
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-dark-text">Admin Review Queue</h1>
        <p className="text-dark-muted mt-1">Account-suspension requests raised by analysts, and every admin decision that closes one</p>
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
            <p className="text-xs text-dark-muted mt-1">Account-suspension requests awaiting your decision</p>
            {metrics && metrics.oldest_pending_minutes > 0 && (
              <p className={`text-xs font-bold mt-1 ${metrics.oldest_pending_minutes >= 120 ? "text-brand-danger" : "text-dark-muted"}`}>
                Oldest waiting: {fmtMins(metrics.oldest_pending_minutes)}
              </p>
            )}
          </div>
          <div className="h-12 w-12 rounded-lg bg-guard-orangeLight border border-guard-orange/30 flex items-center justify-center">
            <Inbox className={`h-6 w-6 text-guard-orange ${counterBump ? "animate-ping" : ""}`} />
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-success">Completed</p>
            <h3 className="text-4xl font-extrabold text-dark-text mt-1">{completedTotal}</h3>
            <p className="text-xs text-dark-muted mt-1">Approved or declined, stamped and audited</p>
          </div>
          <div className="h-12 w-12 rounded-lg bg-brand-success/10 border border-brand-success/30 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-brand-success" />
          </div>
        </div>
      </div>

      {/* Throughput metrics: does the pipeline keep up with inflow? */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Oldest waiting", value: fmtMins(metrics.oldest_pending_minutes), danger: metrics.oldest_pending_minutes >= 120 },
            { label: "Decided (24h)", value: metrics.resolved_24h.toLocaleString(), danger: false },
            { label: "Median decision time", value: fmtMins(metrics.median_resolve_minutes), danger: metrics.median_resolve_minutes >= 120 },
            { label: "Auto-blocked by policy (24h)", value: metrics.auto_resolved_24h.toLocaleString(), danger: false },
          ].map((tile) => (
            <div key={tile.label} className="bg-dark-card border border-dark-border rounded-xl px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-dark-muted block">{tile.label}</span>
              <span className={`text-lg font-extrabold block mt-0.5 ${tile.danger ? "text-brand-danger" : "text-dark-text"}`}>
                {tile.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-xs text-dark-muted font-semibold">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-success opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-success"></span>
        </span>
        Live · refreshes every {POLL_MS / 1000}s
        {fetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-guard-orange" />}
      </div>

      {/* Account-suspension requests + blocklist */}
      <AccountRequestsPanel />
    </div>
  );
};
import React, { useEffect, useState } from "react";
import type { Transaction, AccountSuspendRequest } from "../types";
import {
  X, ShieldCheck, ShieldAlert, AlertCircle, MapPin, Tablet, UserCheck,
  Shield, Activity, PauseCircle, Loader2, User, Fingerprint, Ban, Eye,
} from "lucide-react";
import { getTransactionById, reviewSuspendRequest } from "../services/api";
import { useToast } from "../context/ToastContext";
import { parseApiTimestamp } from "../utils/time";
import { formatPlace, isInNigeria } from "../utils/nigeriaPlaces";

interface TransactionDetailsModalProps {
  transactionId: string | null;
  suspendRequest?: AccountSuspendRequest | null;
  onClose: () => void;
  onReviewed?: () => void;
}

/**
 * Read-only transaction inspector opened from the Review Queue, with the
 * admin account-suspension decision (Suspend / Watchlist) inline. Mirrors the
 * Live Monitor detailed-analysis pane so both surfaces show the same full
 * transaction breakdown.
 */
export const TransactionDetailsModal: React.FC<TransactionDetailsModalProps> = ({
  transactionId,
  suspendRequest,
  onClose,
  onReviewed,
}) => {
  const { showToast } = useToast();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (!transactionId) {
      setTxn(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTxn(null);
    getTransactionById(transactionId)
      .then((data) => {
        if (!cancelled) setTxn(data);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load transaction:", e);
        setError("Could not load this transaction's details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  if (!transactionId) return null;

  const isAuthHold = (t: Transaction) =>
    t.status === "PENDING" && t.required_action === "USER_AUTH";

  const handleDecide = async (decision: "APPROVED" | "WATCHLISTED") => {
    if (!suspendRequest) return;
    setDeciding(true);
    try {
      await reviewSuspendRequest(suspendRequest.request_id, decision);
      if (decision === "APPROVED") {
        showToast("success", "Account suspended", `${suspendRequest.account_id} was added to the account blocklist.`);
      } else {
        showToast("success", "Account watchlisted", `${suspendRequest.account_id} is now flagged for monitoring.`);
      }
      onReviewed?.();
      onClose();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      showToast("danger", "Action failed", typeof detail === "string" ? detail : "Could not review this request.");
    } finally {
      setDeciding(false);
    }
  };

  const statusBadge = (t: Transaction) => {
    if (t.status === "SUSPENDED") {
      return (
        <span className="bg-guard-orangeLight text-guard-orange border border-guard-orange/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
          <PauseCircle className="h-3.5 w-3.5" /> SUSPENDED
        </span>
      );
    }
    if (isAuthHold(t)) {
      return (
        <span className="bg-brand-warning/10 text-brand-warning border border-brand-warning/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
          <Fingerprint className="h-3.5 w-3.5" /> AWAITING USER AUTH
        </span>
      );
    }
    if (t.status === "PENDING") {
      return (
        <span className="bg-brand-info/10 text-brand-info border border-brand-info/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> PENDING
        </span>
      );
    }
    if (t.status === "BLOCKED") {
      return (
        <span className="bg-brand-danger/10 text-brand-danger border border-gray-200 dark:border-dark-border rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
          <ShieldAlert className="h-3.5 w-3.5" /> FRAUD BLOCK
        </span>
      );
    }
    return (
      <span className="bg-brand-success/10 text-brand-success border border-gray-200 dark:border-dark-border rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
        <ShieldCheck className="h-3.5 w-3.5" /> PASS
      </span>
    );
  };

  const canDecide = !!suspendRequest && suspendRequest.status === "PENDING";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-card border border-dark-border rounded-xl shadow-glow-brand w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-dark-muted hover:text-dark-text transition p-1 rounded-lg hover:bg-dark-border/30 z-10"
        >
          <X className="h-5 w-5" />
        </button>

        {loading && (
          <div className="py-20 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
            <p className="text-xs text-dark-muted mt-2">Loading transaction details…</p>
          </div>
        )}

        {!loading && error && (
          <div className="py-20 text-center text-brand-danger text-xs">{error}</div>
        )}

        {!loading && !error && txn && (
          <div className="space-y-5">
            <div className="border-b border-dark-border pb-4 flex items-center justify-between pr-8">
              <div>
                <span className="text-[10px] text-guard-orange font-bold uppercase tracking-wider block">Transaction Details</span>
                <h3 className="text-base font-bold text-dark-text">{txn.transaction_id}</h3>
              </div>
              {statusBadge(txn)}
            </div>

            {/* Account-suspension decision */}
            {suspendRequest && (
              <div
                className={`rounded-lg p-4 space-y-3 border ${
                  suspendRequest.status === "APPROVED"
                    ? "bg-brand-danger/5 border-brand-danger/30"
                    : suspendRequest.status === "WATCHLISTED"
                    ? "bg-brand-info/5 border-brand-info/30"
                    : suspendRequest.status === "DECLINED"
                    ? "bg-gray-50 dark:bg-white/5 border-dark-border"
                    : "bg-brand-warning/5 border-brand-warning/30"
                }`}
              >
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider block text-dark-muted">
                    Account Suspension · {suspendRequest.status}
                  </span>
                  <p className="text-xs text-dark-text font-semibold mt-1 flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-guard-orange" /> {suspendRequest.account_id}
                  </p>
                  {suspendRequest.note && (
                    <p className="text-xs text-dark-text leading-snug whitespace-pre-wrap mt-1.5">{suspendRequest.note}</p>
                  )}
                  <p className="text-[10px] text-dark-muted mt-1.5">
                    Requested by <span className="font-semibold text-dark-text">{suspendRequest.requested_by}</span>
                    {suspendRequest.reviewed_by && (
                      <> · decided by <span className="font-semibold text-dark-text">{suspendRequest.reviewed_by}</span></>
                    )}
                  </p>
                </div>

                {canDecide && (
                  <div className="flex gap-2">
                    <button
                      disabled={deciding}
                      onClick={() => handleDecide("APPROVED")}
                      className="flex-1 bg-brand-danger text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-danger/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      Suspend
                    </button>
                    <button
                      disabled={deciding}
                      onClick={() => handleDecide("WATCHLISTED")}
                      className="flex-1 bg-brand-info text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-info/90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                      Watchlist
                    </button>
                  </div>
                )}
              </div>
            )}

            {txn.claimed_by && (
              <div className="text-[11px] text-guard-orange bg-guard-orangeLight border border-guard-orange/30 rounded-lg px-3 py-2 flex items-center gap-2">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Flagged by <span className="font-semibold">{txn.claimed_by}</span>
                  {txn.claimed_at && (
                    <> at {parseApiTimestamp(txn.claimed_at).toLocaleString()}</>
                  )}
                </span>
              </div>
            )}

            {txn.resolved_by && (
              <div className="text-[11px] text-dark-muted bg-gray-50 dark:bg-white/5 border border-dark-border rounded-lg px-3 py-2">
                Resolved by <span className="font-semibold text-dark-text">{txn.resolved_by}</span>
                {txn.resolved_at && (
                  <> at {parseApiTimestamp(txn.resolved_at).toLocaleString()}</>
                )}
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50/50 dark:bg-white/5 border border-dark-border p-3 rounded-lg">
                <span className="text-[10px] text-dark-muted block uppercase">Amount (NGN)</span>
                <span className="text-lg font-bold text-dark-text">₦{txn.amount.toLocaleString('en-NG')}</span>
              </div>
              <div className="bg-gray-50/50 dark:bg-white/5 border border-dark-border p-3 rounded-lg">
                <span className="text-[10px] text-dark-muted block uppercase">Risk Probability</span>
                <span className="text-lg font-bold text-dark-text">
                  {txn.fraud_probability !== null ? `${(txn.fraud_probability * 100).toFixed(1)}%` : "0.0%"}
                </span>
              </div>
            </div>

            {/* Context info */}
            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 text-xs">
                <UserCheck className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                <div>
                  <span className="text-dark-muted block font-semibold">User Account</span>
                  <span className="text-dark-text">{txn.user_id}</span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs">
                <Shield className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                <div>
                  <span className="text-dark-muted block font-semibold">Beneficiary Account Address</span>
                  <span className="text-dark-text">{txn.beneficiary_id}</span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs">
                <Activity className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                <div>
                  <span className="text-dark-muted block font-semibold">Payment Channel / Method</span>
                  <span className="text-dark-text font-bold uppercase text-[10px] bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-dark-border px-2 py-0.5 rounded tracking-wider">
                    {txn.payment_method || "USSD"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs">
                <Tablet className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                <div>
                  <span className="text-dark-muted block font-semibold">Device fingerprint</span>
                  <span className="text-dark-text truncate max-w-[200px] block">{txn.device_id}</span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs">
                <MapPin className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                <div>
                  <span className="text-dark-muted block font-semibold">Geo location coordinates</span>
                  <span className="text-dark-text text-xs">
                    {txn.location_latitude.toFixed(4)}, {txn.location_longitude.toFixed(4)}
                  </span>
                  <span className={`block text-xs font-semibold ${isInNigeria(txn.location_latitude, txn.location_longitude) ? "text-guard-orange" : "text-red-400"}`}>
                    {formatPlace(txn.location_latitude, txn.location_longitude)}
                  </span>
                </div>
              </div>
            </div>

            {/* Triggered rules explanation */}
            <div className="border-t border-dark-border pt-4">
              <h4 className="text-xs font-bold uppercase text-dark-text mb-2.5">Rule Violations Explanations</h4>
              <div className="space-y-2">
                {txn.triggered_rules && txn.triggered_rules.length > 0 ? (
                  txn.triggered_rules.map((rule, idx) => (
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
        )}
      </div>
    </div>
  );
};

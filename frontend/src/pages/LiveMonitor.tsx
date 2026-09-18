import React, { useState } from "react";
import type { Transaction } from "../types";
import { resolveTransaction, getStoredUser } from "../services/api";
import { ShieldCheck, ShieldAlert, AlertCircle, RefreshCw, MapPin, Tablet, UserCheck, Shield, Activity, PauseCircle, Loader2 } from "lucide-react";

interface LiveMonitorProps {
  transactions: Transaction[];
  onRefresh: () => void;
}

export const LiveMonitor: React.FC<LiveMonitorProps> = ({ transactions, onRefresh }) => {
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === "admin";

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  };

  const handleResolve = async (txnId: string, decision: "APPROVED" | "BLOCKED") => {
    setResolvingId(txnId);
    try {
      const updated = await resolveTransaction(txnId, decision);
      if (selectedTxn?.transaction_id === txnId) {
        setSelectedTxn({ ...selectedTxn, ...updated });
      }
      await onRefresh();
    } catch (e) {
      console.error("Failed to resolve transaction:", e);
    } finally {
      setResolvingId(null);
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

  const getStatusDisplay = (status: string | null | undefined) => {
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

  // ACTION cell: LOW -> plain "Approved" label, HIGH -> plain "Blocked" label,
  // MEDIUM/SUSPENDED -> a real Suspend button (or, for an admin, inline
  // Approve/Block resolve buttons since they're the ones allowed to clear it).
  const getActionCell = (txn: Transaction) => {
    const isBusy = resolvingId === txn.transaction_id;

    if (txn.status === "SUSPENDED") {
      if (isAdmin) {
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
          </div>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md bg-guard-orangeLight text-guard-orange border border-guard-orange/30">
          <PauseCircle className="h-3 w-3" /> Suspend
        </span>
      );
    }

    if (txn.status === "BLOCKED") {
      return <span className="text-xs font-bold text-brand-danger">Blocked</span>;
    }
    return <span className="text-xs font-bold text-brand-success">Approved</span>;
  };

  return (
    <div className="space-y-6">
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
          <div className="px-5 py-4 border-b border-dark-border flex items-center justify-between">
            <h3 className="text-lg font-semibold text-dark-text font-mono">Surveillance Stream</h3>
            <span className="text-[10px] bg-guard-orangeLight text-guard-orange font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
              {transactions.length} Cached Logs
            </span>
          </div>
          
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            {transactions.length > 0 ? (
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-100/70 text-[11px] text-dark-muted uppercase font-bold tracking-wider sticky top-0">
                  <tr>
                    <th className="px-3 py-3">Txn ID</th>
                    <th className="px-3 py-3">User</th>
                    <th className="px-3 py-3">Amount</th>
                    <th className="px-3 py-3">Risk score</th>
                    <th className="px-3 py-3">Action</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {transactions.map((txn, idx) => (
                    <tr
                      key={idx}
                      onClick={() => setSelectedTxn(txn)}
                      className={`hover:bg-dark-border/25 cursor-pointer transition ${
                        selectedTxn?.transaction_id === txn.transaction_id ? "bg-guard-orangeLight/40 border-l-4 border-l-guard-orange" : ""
                      } ${txn.status === "SUSPENDED" ? "bg-amber-50/40" : ""}`}
                    >
                      <td className="px-3 py-3.5 font-mono text-xs font-semibold text-dark-text">
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
                        {getStatusDisplay(txn.status)}
                      </td>
                      <td className="px-3 py-3.5 text-right text-xs text-dark-muted">
                        {new Date(txn.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-20 text-center text-dark-muted flex flex-col items-center justify-center gap-3">
                <RefreshCw className="h-8 w-8 animate-pulse text-dark-border" />
                <p className="text-sm">No transaction events recorded yet.</p>
                <p className="text-xs text-dark-muted">Simulate a transaction or capture a webhook to stream events here.</p>
              </div>
            )}
          </div>
        </div>

        {/* Detailed Insights Pane */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand h-fit">
          {selectedTxn ? (
            <div className="space-y-5">
              <div className="border-b border-dark-border pb-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-guard-orange font-bold uppercase tracking-wider block">Detailed Analysis</span>
                  <h3 className="text-base font-mono font-bold text-dark-text">{selectedTxn.transaction_id}</h3>
                </div>
                {selectedTxn.status === "SUSPENDED" ? (
                  <span className="bg-guard-orangeLight text-guard-orange border border-guard-orange/30 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <PauseCircle className="h-3.5 w-3.5" /> SUSPENDED
                  </span>
                ) : selectedTxn.status === "BLOCKED" ? (
                  <span className="bg-brand-danger/10 text-brand-danger border border-gray-200 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" /> FRAUD BLOCK
                  </span>
                ) : (
                  <span className="bg-brand-success/10 text-brand-success border border-gray-200 rounded px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" /> PASS
                  </span>
                )}
              </div>

              {/* Suspended: admin resolve panel */}
              {selectedTxn.status === "SUSPENDED" && (
                <div className="bg-guard-orangeLight border border-guard-orange/30 rounded-lg p-4 space-y-3">
                  <p className="text-xs text-guard-orange font-semibold leading-relaxed">
                    This transaction is held pending review. Funds will not move until an admin approves or blocks it.
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
                  ) : (
                    <p className="text-[11px] text-guard-orange/80 font-medium italic">
                      Only an admin account can resolve this. Sign in with an admin email to take action.
                    </p>
                  )}
                </div>
              )}

              {selectedTxn.resolved_by && (
                <div className="text-[11px] text-dark-muted bg-gray-50 border border-dark-border rounded-lg px-3 py-2">
                  Resolved by <span className="font-semibold text-dark-text">{selectedTxn.resolved_by}</span>
                  {selectedTxn.resolved_at && (
                    <> at {new Date(selectedTxn.resolved_at).toLocaleString()}</>
                  )}
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50/50 border border-dark-border p-3 rounded-lg">
                  <span className="text-[10px] text-dark-muted block uppercase">Amount (NGN)</span>
                  <span className="text-lg font-bold text-dark-text">₦{selectedTxn.amount.toLocaleString('en-NG')}</span>
                </div>
                <div className="bg-gray-50/50 border border-dark-border p-3 rounded-lg">
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
                    <span className="text-dark-text font-mono">{selectedTxn.user_id}</span>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 text-xs">
                  <Shield className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Beneficiary Account Address</span>
                    <span className="text-dark-text font-mono">{selectedTxn.beneficiary_id}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <Activity className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Payment Channel / Method</span>
                    <span className="text-dark-text font-bold uppercase text-[10px] bg-gray-100 border border-gray-200 px-2 py-0.5 rounded tracking-wider">
                      {selectedTxn.payment_method || "USSD"}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <Tablet className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Device fingerprint</span>
                    <span className="text-dark-text font-mono truncate max-w-[200px] block">{selectedTxn.device_id}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <MapPin className="h-4.5 w-4.5 text-guard-orange shrink-0 mt-0.5" />
                  <div>
                    <span className="text-dark-muted block font-semibold">Geo location coordinates</span>
                    <span className="text-dark-text font-mono text-xs">
                      {selectedTxn.location_latitude.toFixed(4)}, {selectedTxn.location_longitude.toFixed(4)}
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

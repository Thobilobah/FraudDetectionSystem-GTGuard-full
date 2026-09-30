import React, { useEffect, useState } from "react";
import type { RealTimeMetrics, ModelMetadata, Transaction } from "../types";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from "recharts";
import { 
  ShieldAlert, ShieldCheck, Activity, Percent, ArrowUpRight, TrendingUp, AlertTriangle, Inbox, Flag, Loader2, Clock
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { getStoredUser, getTransactionsPage, type QueueMetrics } from "../services/api";
import { parseApiTimestamp } from "../utils/time";

interface DashboardProps {
  metrics: RealTimeMetrics;
  modelMeta: ModelMetadata | null;
  latestTransactions: Transaction[];
  onNavigate: (tab: string) => void;
  // Admin Review Queue counters, polled by App every 10s (null for analysts).
  pendingQueueCount?: number | null;
  resolvedCount?: number | null;
  // Full queue stats (median resolve time, oldest waiting) for the admin card.
  queueMetrics?: QueueMetrics | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  metrics, 
  modelMeta, 
  latestTransactions,
  onNavigate,
  pendingQueueCount,
  resolvedCount,
  queueMetrics
}) => {
  const { theme } = useTheme();
  const isAdmin = getStoredUser()?.role === "admin";
  const gridStroke = theme === "dark" ? "#292C33" : "#E5E7EB";
  const axisStroke = "#9CA3AF"; // mid-gray reads fine on both light and dark backgrounds
  const highRiskAlerts = latestTransactions
    .filter(t => t.risk_score !== null && t.risk_score >= 70)
    .slice(0, 5);

  // Analyst's own flagged work: server-filtered on claimed_by = my email, so
  // every analyst sees ONLY the transactions they personally suspended
  // (each analyst's section is unique to them), newest first.
  const analystEmail = !isAdmin ? (getStoredUser()?.email ?? "") : "";
  const myFlagsPageSize = 10;
  const [myFlags, setMyFlags] = useState<Transaction[]>([]);
  const [myFlagsTotal, setMyFlagsTotal] = useState(0);
  const [myFlagsPage, setMyFlagsPage] = useState(0);
  const [myFlagsLoading, setMyFlagsLoading] = useState(true);

  useEffect(() => {
    if (!analystEmail) return;
    let alive = true;
    const loadFlags = async () => {
      try {
        const page = await getTransactionsPage({
          flagged_by: analystEmail,
          limit: myFlagsPageSize,
          offset: myFlagsPage * myFlagsPageSize,
          sort: "desc",
        });
        if (!alive) return;
        setMyFlags(page.items);
        setMyFlagsTotal(page.total);
        // Snap back if this page emptied (last row resolved elsewhere, or a
        // shrinking list left this offset beyond the end).
        if (page.items.length === 0 && page.total > 0 && myFlagsPage > 0) {
          setMyFlagsPage(Math.max(0, Math.ceil(page.total / myFlagsPageSize) - 1));
        }
      } catch (e) {
        console.error("My flagged transactions failed:", e);
      } finally {
        if (alive) setMyFlagsLoading(false);
      }
    };
    loadFlags();
    const id = window.setInterval(loadFlags, 10000);
    return () => { alive = false; window.clearInterval(id); };
  }, [analystEmail, myFlagsPage]);

  const myFlagsTotalPages = Math.max(1, Math.ceil(myFlagsTotal / myFlagsPageSize));

  const fmtWhen = (iso: string | null | undefined) =>
    iso ? parseApiTimestamp(iso).toLocaleString("en-NG", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    }) : "—";

  // Compact minutes -> "45m" / "2h 14m" for the queue stats.
  const fmtMins = (mins: number) => {
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const flagRiskBadge = (level: string | null) => {
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

  // Format hourly trend data for recharts
  const chartData = metrics.hourly_trend.map(t => ({
    hour: `${t.hour}:00`,
    Transactions: t.count,
    Fraud: t.fraud_count || 0
  }));

  // Standard cards data
  const kpis = [
    {
      title: "Total Analyzed",
      value: metrics.total_transactions,
      sub: "All API & Webhook events",
      icon: Activity,
      color: "text-brand-primary",
      bg: "bg-brand-primary/10",
      border: "border-gray-200"
    },
    {
      title: "Fraud Blocked",
      value: metrics.fraud_transactions,
      sub: "Identified & quarantined",
      icon: ShieldAlert,
      color: "text-brand-danger",
      bg: "bg-brand-danger/10",
      border: "border-brand-danger/20"
    },
    {
      title: "Genuine Captured",
      value: metrics.genuine_transactions,
      sub: "Bypassed without friction",
      icon: ShieldCheck,
      color: "text-brand-success",
      bg: "bg-brand-success/10",
      border: "border-brand-success/20"
    },
    {
      title: "Fraud Rate",
      value: `${metrics.fraud_percentage.toFixed(2)}%`,
      sub: "Ratio of total events",
      icon: Percent,
      color: "text-brand-warning",
      bg: "bg-brand-warning/10",
      border: "border-brand-warning/20"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-dark-text">Risk Intelligence Dashboard</h1>
        <p className="text-dark-muted mt-1">Real-time surveillance & automated ML model analytics</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, idx) => (
          <div 
            key={idx} 
            className={`bg-dark-card border ${kpi.border} dark:border-dark-border rounded-xl p-5 shadow-glow-brand flex items-center justify-between transition hover:scale-[1.02]`}
          >
            <div>
              <p className="text-sm font-medium text-dark-muted">{kpi.title}</p>
              <h3 className="text-3xl font-semibold text-dark-text mt-1">{kpi.value}</h3>
              <p className="text-xs text-dark-muted mt-1">{kpi.sub}</p>
            </div>
            <div className={`p-3 rounded-lg ${kpi.bg}`}>
              <kpi.icon className={`h-6 w-6 ${kpi.color}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Analyst's own flagged work - analysts only, uniquely scoped to
          claimed_by = this analyst's email (admins use the Review Queue) */}
      {!isAdmin && (
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-guard-orangeLight border border-guard-orange/30 flex items-center justify-center shrink-0">
                <Flag className="h-5 w-5 text-guard-orange" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-dark-text">My Flagged Transactions</h3>
                <p className="text-xs text-dark-muted">Transactions you suspended for admin review — newest first</p>
              </div>
            </div>
            <span className="self-start sm:self-auto inline-flex items-center gap-1.5 text-xs font-bold bg-guard-orangeLight border border-guard-orange/30 text-guard-orange px-3 py-1.5 rounded-full whitespace-nowrap">
              <Flag className="h-3.5 w-3.5" /> {myFlagsTotal} flagged
            </span>
          </div>

          {myFlagsLoading && myFlags.length === 0 ? (
            <div className="py-10 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
              <p className="text-xs text-dark-muted mt-2">Loading your flagged transactions…</p>
            </div>
          ) : myFlags.length > 0 ? (
            <div>
              <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-100/70 dark:bg-dark-card text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                  <tr>
                    <th className="px-3 py-3">Flagged At</th>
                    <th className="px-3 py-3">Transaction ID</th>
                    <th className="px-3 py-3">User Account</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3 text-center">Risk</th>
                    <th className="px-3 py-3">Current Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-dark-border text-sm">
                  {myFlags.map((row) => (
                    <tr key={row.transaction_id} className="hover:bg-dark-border/10 transition">
                      <td className="px-3 py-3 text-xs text-dark-muted font-semibold whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {fmtWhen(row.claimed_at || row.created_at)}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-semibold text-dark-text">{row.transaction_id}</td>
                      <td className="px-3 py-3 text-dark-text font-medium">{row.user_id}</td>
                      <td className="px-3 py-3 text-dark-text font-bold text-right">₦{row.amount.toLocaleString("en-NG")}</td>
                      <td className="px-3 py-3 text-center">{flagRiskBadge(row.risk_level)}</td>
                      <td className="px-3 py-3">
                        {row.status === "SUSPENDED" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-guard-orange bg-guard-orangeLight border border-guard-orange/30 px-2 py-0.5 rounded">
                            <Clock className="h-3 w-3" /> Awaiting admin review
                          </span>
                        ) : row.status === "APPROVED" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-success bg-brand-success/10 px-2 py-0.5 rounded">
                            <ShieldCheck className="h-3 w-3" /> Approved{row.resolved_by ? ` by ${row.resolved_by}` : ""}
                          </span>
                        ) : row.status === "BLOCKED" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-danger bg-brand-danger/10 px-2 py-0.5 rounded">
                            <ShieldAlert className="h-3 w-3" /> Blocked{row.resolved_by ? ` by ${row.resolved_by}` : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-dark-muted font-semibold">{row.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {myFlagsTotalPages > 1 && (
                <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-dark-border">
                  <button
                    onClick={() => setMyFlagsPage((p) => Math.max(0, p - 1))}
                    disabled={myFlagsPage === 0}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-dark-muted font-semibold">
                    Page {myFlagsPage + 1} of {myFlagsTotalPages}
                  </span>
                  <button
                    onClick={() => setMyFlagsPage((p) => Math.min(myFlagsTotalPages - 1, p + 1))}
                    disabled={myFlagsPage >= myFlagsTotalPages - 1}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-dark-muted">
              <Flag className="h-8 w-8 text-dark-muted/50 mx-auto mb-2" />
              You haven't flagged any transactions yet. Suspend a medium-risk result from the
              Live Monitor or Transaction Analyzer and it will appear here.
            </div>
          )}
        </div>
      )}

      {/* Admin Review Queue summary - admins only */}
      {isAdmin && (
        <button
          onClick={() => onNavigate("review")}
          className="w-full text-left bg-dark-card border border-guard-orange/40 rounded-xl p-5 shadow-glow-brand flex items-center justify-between gap-4 transition hover:border-guard-orange group"
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-12 w-12 rounded-lg bg-guard-orangeLight border border-guard-orange/30 flex items-center justify-center shrink-0">
              <Inbox className="h-6 w-6 text-guard-orange" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-guard-orange block">Review Queue</span>
              <span className="text-sm text-dark-text font-semibold block truncate">
                {(pendingQueueCount ?? 0) > 0
                  ? `${pendingQueueCount} transaction${pendingQueueCount === 1 ? "" : "s"} flagged by analysts awaiting your decision`
                  : "No pending work — analysts haven't flagged anything right now"}
              </span>
              <span className="text-xs text-dark-muted block mt-0.5">
                {resolvedCount ?? 0} completed review{(resolvedCount ?? 0) === 1 ? "" : "s"} stamped
              </span>
              {queueMetrics && (
                <span className="text-xs text-dark-muted block mt-0.5">
                  Median decision time {fmtMins(queueMetrics.median_resolve_minutes)} · oldest waiting{" "}
                  {fmtMins(queueMetrics.oldest_pending_minutes)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <span className="text-4xl font-extrabold text-guard-orange block leading-none">
                {pendingQueueCount ?? 0}
              </span>
              <span className="text-[10px] text-dark-muted font-bold uppercase tracking-wider">Pending</span>
            </div>
            <span className="text-guard-orange font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
              Open <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </button>
      )}

      {/* Grid of Chart & Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hourly Volume Chart */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-dark-text">Real-Time Traffic Analytics</h3>
              <p className="text-xs text-dark-muted">Transactions vs Fraud incidents by hour of day</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-brand-success bg-brand-success/10 px-2.5 py-1 rounded-full">
              <TrendingUp className="h-4 w-4" /> Live Feeds Active
            </div>
          </div>
          <div className="h-72 w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorFraud" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="hour" stroke={axisStroke} fontSize={11} />
                  <YAxis stroke={axisStroke} fontSize={11} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#151D30", borderColor: "#222E4A", color: "#F3F4F6" }} 
                    itemStyle={{ color: "#F3F4F6" }}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="Transactions" stroke="#4F46E5" fillOpacity={1} fill="url(#colorTx)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Fraud" stroke="#EF4444" fillOpacity={1} fill="url(#colorFraud)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-dark-muted">
                No transaction data available yet. Generate transactions in simulator.
              </div>
            )}
          </div>
        </div>

        {/* Live Alerts list */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-semibold text-dark-text">Critical Risk Alerts</h3>
            <p className="text-xs text-dark-muted mb-4">Latest transactions with risk score &ge; 70%</p>
            
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {highRiskAlerts.length > 0 ? (
                highRiskAlerts.map((alert, idx) => (
                  <div key={idx} className="border border-brand-danger/20 bg-brand-danger/5 rounded-lg p-3 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-brand-danger shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-dark-text">{alert.transaction_id}</span>
                        <span className="text-xs font-bold text-brand-danger bg-brand-danger/10 px-2 py-0.5 rounded">
                          Score {alert.risk_score}
                        </span>
                      </div>
                      <p className="text-xs text-dark-text mt-1">₦{alert.amount.toLocaleString('en-NG')} from {alert.user_id}</p>
                      {alert.triggered_rules && alert.triggered_rules.length > 0 && (
                        <p className="text-[10px] text-brand-danger font-medium mt-0.5 truncate">
                          Rule: {alert.triggered_rules[0].rule_name}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-dark-muted">
                  No high-risk transactions reported. All systems clear.
                </div>
              )}
            </div>
          </div>
          
          <button 
            onClick={() => onNavigate("monitor")}
            className="mt-4 w-full bg-dark-border border border-dark-border hover:border-guard-orange text-dark-text text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1 transition"
          >
            Open Live Monitor <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Model Information Summary */}
      {modelMeta && (
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-dark-text">Active Machine Learning Pipeline</h3>
              <p className="text-xs text-dark-muted mt-0.5">Model details automatically updated upon pipeline compilation</p>
            </div>
            <div className="bg-guard-orangeLight border border-guard-orange/30 rounded-lg px-4 py-2 text-right">
              <span className="text-[10px] text-guard-orange font-bold uppercase tracking-wider block">Selected Model</span>
              <span className="text-sm font-semibold text-dark-text">{modelMeta.selected_model}</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mt-6 border-t border-dark-border pt-5">
            <div>
              <span className="text-xs text-dark-muted block">F1-Score</span>
              <span className="text-lg font-bold text-dark-text">{(modelMeta.metrics.f1 * 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-xs text-dark-muted block">Recall (Sensitivity)</span>
              <span className="text-lg font-bold text-dark-text">{(modelMeta.metrics.recall * 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-xs text-dark-muted block">ROC-AUC</span>
              <span className="text-lg font-bold text-dark-text">{(modelMeta.metrics.roc_auc * 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-xs text-dark-muted block">Precision</span>
              <span className="text-lg font-bold text-dark-text">{(modelMeta.metrics.precision * 100).toFixed(1)}%</span>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <span className="text-xs text-dark-muted block">Training Time</span>
              <span className="text-lg font-bold text-dark-text">{modelMeta.metrics.training_time.toFixed(3)}s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

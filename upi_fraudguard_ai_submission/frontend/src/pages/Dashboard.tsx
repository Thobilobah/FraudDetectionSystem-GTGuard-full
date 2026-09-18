import React from "react";
import type { RealTimeMetrics, ModelMetadata, Transaction } from "../types";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from "recharts";
import { 
  ShieldAlert, ShieldCheck, Activity, Percent, ArrowUpRight, TrendingUp, AlertTriangle
} from "lucide-react";

interface DashboardProps {
  metrics: RealTimeMetrics;
  modelMeta: ModelMetadata | null;
  latestTransactions: Transaction[];
  onNavigate: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  metrics, 
  modelMeta, 
  latestTransactions,
  onNavigate
}) => {
  const highRiskAlerts = latestTransactions
    .filter(t => t.risk_score !== null && t.risk_score >= 70)
    .slice(0, 5);

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
            className={`bg-dark-card border ${kpi.border} rounded-xl p-5 shadow-glow-brand flex items-center justify-between transition hover:scale-[1.02]`}
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="hour" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
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
                      <p className="text-xs text-dark-text mt-1">₹{alert.amount.toLocaleString('en-IN')} from {alert.user_id}</p>
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
            className="mt-4 w-full bg-dark-border border border-dark-border hover:border-brand-primary text-dark-text text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1 transition"
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
            <div className="bg-brand-primary/10 border border-brand-primary/30 rounded-lg px-4 py-2 text-right">
              <span className="text-[10px] text-brand-primary font-bold uppercase tracking-wider block">Selected Model</span>
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

import React from "react";
import { Link, CheckCircle, XCircle, AlertTriangle, ShieldCheck, HelpCircle } from "lucide-react";

interface SystemStatusProps {
  health: {
    status: string;
    service: string;
    database_engine?: string;
    database_connected: boolean;
    razorpay_mode: string;
  } | null;
}

export const SystemStatus: React.FC<SystemStatusProps> = ({ health }) => {
  const isGtcoConfigured = health?.razorpay_mode === "LIVE";
  
  const endpoints = [
    { method: "GET", path: "/health", desc: "System health check & integration status verification" },
    { method: "GET", path: "/model-info", desc: "Active classifier serialization metadata & performance summaries" },
    { method: "GET", path: "/feature-explanation", desc: "Documentation schema mapping details for the 35 ML features" },
    { method: "POST", path: "/predict", desc: "Raw transaction intake. Triggers feature engineering, model prediction, and rule engine evaluations" },
    { method: "POST", path: "/predict/features", desc: "Direct ML classifier pipeline test using raw 35-feature vector" },
    { method: "POST", path: "/demo/generate", desc: "Generates realistic raw parameters for Normal, Suspicious, or High-Risk scenarios" },
    { method: "POST", path: "/webhooks/gtco", desc: "Live integration endpoint validating HMAC capture events" },
    { method: "GET", path: "/transactions", desc: "Ledger history retrieval endpoint" },
    { method: "GET", path: "/analytics", desc: "Real-time KPI metrics aggregator & comparative reports compiler" }
  ];

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-dark-text">System & Integration Status</h1>
        <p className="text-dark-muted mt-1">Audit active microservices, API endpoints, and payment webhook integrations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Connection Status Card */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand md:col-span-1 space-y-4">
          <h3 className="text-base font-semibold text-dark-text">System Status</h3>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-dark-border rounded-lg text-xs">
              <span className="text-dark-muted">Core API Service</span>
              <span className="text-brand-success font-bold flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5" /> Healthy
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-dark-border rounded-lg text-xs">
              <span className="text-dark-muted">{health?.database_engine || "PostgreSQL"} Repository</span>
              {health?.database_connected ? (
                <span className="text-brand-success font-bold flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5" /> Connected
                </span>
              ) : (
                <span className="text-brand-danger font-bold flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" /> Disconnected
                </span>
              )}
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-dark-border rounded-lg text-xs">
              <span className="text-dark-muted">GTCO Payment Integration</span>
              {isGtcoConfigured ? (
                <span className="text-brand-success font-bold flex items-center gap-1 uppercase">
                  <CheckCircle className="h-3.5 w-3.5" /> Connected
                </span>
              ) : (
                <span className="text-brand-warning font-bold flex items-center gap-1 uppercase">
                  <AlertTriangle className="h-3.5 w-3.5 animate-pulse" /> DEMO MODE
                </span>
              )}
            </div>
          </div>
        </div>

        {/* GTCO Setup Warning */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand md:col-span-2 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-dark-text">GTCO Webhook Credentials</h3>
            {isGtcoConfigured ? (
              <div className="bg-brand-success/5 border border-brand-success/20 rounded-xl p-4 text-xs space-y-2 text-brand-success leading-relaxed">
                <p className="font-bold flex items-center gap-1">
                  <ShieldCheck className="h-4 w-4" /> Live Webhooks Captures Configured
                </p>
                <p className="text-dark-text">
                  The API is listening for capturing webhook requests on `POST /webhooks/gtco`.
                  Signatures will be verified securely using SHA256 HMAC encryption keys.
                </p>
              </div>
            ) : (
              <div className="bg-guard-orangeLight border border-guard-orange/30 rounded-xl p-4 text-xs space-y-2 text-guard-orange leading-relaxed">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> GTCO integration not configured — running in Demo Mode.
                </p>
                <p className="text-dark-text">
                  No live secrets (`GTCO_KEY_ID`, `GTCO_WEBHOOK_SECRET`) were detected in `.env`.
                  The application remains fully functional using the Transaction Simulator. Webhook validation will bypass checks when variables are empty, allowing painless development.
                </p>
              </div>
            )}
          </div>
          <div className="space-y-2 mt-3">
            <div className="text-xs text-dark-muted font-mono bg-gray-50 border border-dark-border p-2.5 rounded-lg">
              <span className="text-[9px] text-dark-muted block uppercase font-bold mb-1 tracking-wider">Local Webhook Endpoint</span>
              http://localhost:8000/webhooks/gtco
            </div>
            <div className="text-xs text-guard-orange font-mono bg-guard-orangeLight border border-guard-orange/20 p-2.5 rounded-lg">
              <span className="text-[9px] text-guard-orange block uppercase font-bold mb-1 tracking-wider">Public Tunnel Endpoint (Serveo)</span>
              https://[your-tunnel-id].serveousercontent.com/webhooks/gtco
            </div>
          </div>
        </div>
      </div>

      {/* Feature Engineering Explainability Block */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand space-y-4">
        <h3 className="text-lg font-semibold text-dark-text">Automated Feature Engineering Flow</h3>
        <p className="text-xs text-dark-muted leading-relaxed">
          GTCO provides simple raw transaction objects. It will <strong>NOT</strong> provide high-dimensional fraud signals.
          Our GT GUARD feature-engineering layer enriches every raw payment capture event in real-time, executing SQL queries,
          velocity checks, geofencing validations, and statistical deviations.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2 text-center text-xs">
          <div className="bg-gray-50/50 border border-dark-border rounded-lg p-3 space-y-1">
            <span className="text-[10px] text-brand-info font-bold block">1. RAW WEBHOOK</span>
            <span className="text-dark-text block font-semibold font-mono">Amount, Account, GPS, Time</span>
          </div>
          <div className="flex items-center justify-center text-dark-muted font-bold text-lg">&rarr;</div>
          <div className="bg-gray-50/50 border border-dark-border rounded-lg p-3 space-y-1 md:col-span-2">
            <span className="text-[10px] text-guard-orange font-bold block">2. FEATURE ENGINEERING ENGINE</span>
            <span className="text-dark-text block font-semibold">Haversine Distance, SQL History Averages, Velocity Windows</span>
          </div>
          <div className="flex items-center justify-center text-dark-muted font-bold text-lg">&rarr;</div>
          <div className="bg-gray-50/50 border border-dark-border rounded-lg p-3 space-y-1">
            <span className="text-[10px] text-brand-success font-bold block">3. 35 ML DIMENSIONS</span>
            <span className="text-dark-text block font-semibold font-mono">z_score, velocity_5m, travel_flag</span>
          </div>
        </div>
      </div>

      {/* Endpoint API Documentation */}
      <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden">
        <div className="px-5 py-4 border-b border-dark-border">
          <h3 className="text-lg font-semibold text-dark-text">API Reference Endpoints</h3>
        </div>

        <div className="divide-y divide-gray-100">
          {endpoints.map((ep, idx) => (
            <div key={idx} className="p-4 flex flex-col sm:flex-row items-start gap-3 sm:gap-6 text-sm">
              <span className={`px-3 py-1 rounded text-xs font-bold font-mono min-w-[70px] text-center ${
                ep.method === "GET" 
                  ? "bg-brand-info/10 text-brand-info border border-brand-info/20" 
                  : "bg-guard-orangeLight text-guard-orange border border-guard-orange/20"
              }`}>
                {ep.method}
              </span>
              <div className="space-y-1">
                <span className="font-mono text-dark-text font-semibold block">{ep.path}</span>
                <span className="text-xs text-dark-muted block leading-relaxed">{ep.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

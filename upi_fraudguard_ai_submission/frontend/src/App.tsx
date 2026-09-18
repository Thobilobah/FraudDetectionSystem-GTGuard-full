import React, { useState, useEffect } from "react";
import { getHealth, getAnalytics, getTransactions, selectActiveModel } from "./services/api";
import type { RealTimeMetrics, ModelMetadata, ModelComparison, FeatureImportance, Transaction } from "./types";
import { Dashboard } from "./pages/Dashboard";
import { LiveMonitor } from "./pages/LiveMonitor";
import { TransactionAnalyzer } from "./pages/TransactionAnalyzer";
import { ModelPerformance } from "./pages/ModelPerformance";
import { TransactionHistory } from "./pages/TransactionHistory";
import { SystemStatus } from "./pages/SystemStatus";
import { 
  Shield, LayoutDashboard, Radio, Activity, BarChart2, History, Server,
  Menu, X, AlertTriangle, ShieldCheck
} from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  
  // API state
  const [health, setHealth] = useState<any>(null);
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics>({
    total_transactions: 0,
    fraud_transactions: 0,
    genuine_transactions: 0,
    fraud_percentage: 0.0,
    high_risk_transactions: 0,
    hourly_trend: []
  });
  const [modelMeta, setModelMeta] = useState<ModelMetadata | null>(null);
  const [modelComparisons, setModelComparisons] = useState<ModelComparison[]>([]);
  const [featureImportance, setFeatureImportance] = useState<FeatureImportance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const fetchAllData = async () => {
    try {
      // 1. Fetch health
      const healthData = await getHealth();
      setHealth(healthData);

      // 2. Fetch analytics
      const analyticsData = await getAnalytics();
      setRealTimeMetrics(analyticsData.real_time_metrics);
      setModelMeta(analyticsData.model_metadata);
      setModelComparisons(analyticsData.model_comparison);
      setFeatureImportance(analyticsData.feature_importance);

      // 3. Fetch transaction log
      const transactionsData = await getTransactions(100);
      setTransactions(transactionsData);
    } catch (e) {
      console.error("Error polling backend APIs: ", e);
    }
  };

  const handleSelectModel = async (modelName: string) => {
    try {
      await selectActiveModel(modelName);
      await fetchAllData();
    } catch (e) {
      console.error("Error switching model:", e);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchAllData();

    // Setup polling interval every 5 seconds to support live updates
    const interval = setInterval(() => {
      fetchAllData();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const getActiveTabClass = (tab: string) => {
    return activeTab === tab
      ? "bg-brand-primary text-white shadow-sm"
      : "text-dark-muted hover:bg-dark-border/40 hover:text-dark-text";
  };

  const renderActiveTabContent = () => {
    switch (activeTab) {
      case "dashboard":
        return (
          <Dashboard 
            metrics={realTimeMetrics}
            modelMeta={modelMeta}
            latestTransactions={transactions}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        );
      case "monitor":
        return <LiveMonitor transactions={transactions} onRefresh={fetchAllData} />;
      case "analyzer":
        return <TransactionAnalyzer />;
      case "performance":
        return (
          <ModelPerformance 
            modelMeta={modelMeta}
            comparison={modelComparisons}
            featureImportance={featureImportance}
            onSelectModel={handleSelectModel}
          />
        );
      case "history":
        return <TransactionHistory transactions={transactions} />;
      case "status":
        return <SystemStatus health={health} />;
      default:
        return <Dashboard metrics={realTimeMetrics} modelMeta={modelMeta} latestTransactions={transactions} onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-dark-bg text-dark-text flex">
      {/* Sidebar for Desktop */}
      <aside 
        className={`bg-dark-card border-r border-dark-border w-64 fixed inset-y-0 left-0 z-30 transform transition-transform md:translate-x-0 md:static ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-full flex flex-col justify-between p-5">
          <div className="space-y-6">
            {/* Logo */}
            <div className="flex items-center gap-2 pb-4 border-b border-dark-border">
              <div className="bg-brand-primary text-white p-2 rounded-lg shadow-glow-brand">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <span className="font-extrabold text-dark-text text-base tracking-tight block">FraudGuard AI</span>
                <span className="text-[10px] text-brand-primary font-bold uppercase tracking-wider block">UPI SURVEILLANCE</span>
              </div>
            </div>

            {/* Navigation links */}
            <nav className="space-y-1.5">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${getActiveTabClass("dashboard")}`}
              >
                <LayoutDashboard className="h-4.5 w-4.5" />
                Risk Intelligence
              </button>

              <button
                onClick={() => setActiveTab("monitor")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${getActiveTabClass("monitor")}`}
              >
                <Radio className="h-4.5 w-4.5" />
                Live Monitor
              </button>

              <button
                onClick={() => setActiveTab("analyzer")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${getActiveTabClass("analyzer")}`}
              >
                <Activity className="h-4.5 w-4.5" />
                Transaction Analyzer
              </button>

              <button
                onClick={() => setActiveTab("performance")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${getActiveTabClass("performance")}`}
              >
                <BarChart2 className="h-4.5 w-4.5" />
                Model Performance
              </button>

              <button
                onClick={() => setActiveTab("history")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${getActiveTabClass("history")}`}
              >
                <History className="h-4.5 w-4.5" />
                Transaction History
              </button>

              <button
                onClick={() => setActiveTab("status")}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition ${getActiveTabClass("status")}`}
              >
                <Server className="h-4.5 w-4.5" />
                System Integration
              </button>
            </nav>
          </div>

          {/* Bottom section */}
          <div className="border-t border-dark-border pt-4 text-[11px] text-dark-muted font-semibold space-y-2">
            <div className="flex items-center gap-1.5 justify-between">
              <span>Razorpay Integration:</span>
              {health?.razorpay_mode === "LIVE" ? (
                <span className="text-brand-success font-bold flex items-center gap-0.5">
                  <ShieldCheck className="h-3 w-3" /> CONNECTED
                </span>
              ) : (
                <span className="text-brand-warning font-bold flex items-center gap-0.5">
                  <AlertTriangle className="h-3 w-3" /> DEMO MODE
                </span>
              )}
            </div>
            <div className="text-center font-mono py-1 bg-gray-50 border border-dark-border rounded">
              v1.0.0 (Hackathon)
            </div>
          </div>
        </div>
      </aside>

      {/* Main Panel Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="bg-dark-card border-b border-dark-border h-16 flex items-center justify-between px-6 z-10">
          <button 
            onClick={() => setIsSidebarOpen(prev => !prev)}
            className="text-dark-text hover:text-brand-primary p-2 md:hidden"
          >
            {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          
          <div className="flex items-center gap-4 ml-auto">
            {/* Indicators */}
            <div className="hidden sm:flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-brand-success animate-ping"></span>
              <span className="text-xs font-bold text-dark-muted">Feeds Status: Live Surveillance</span>
            </div>
            <div className="h-8 w-8 rounded-full bg-brand-primary/20 border border-brand-primary/30 flex items-center justify-center font-bold text-sm text-brand-primary uppercase">
              UF
            </div>
          </div>
        </header>

        {/* Scrollable Content Container */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            {renderActiveTabContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

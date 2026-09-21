import React, { useState } from "react";
import type { Transaction } from "../types";
import { Search, ShieldAlert, ShieldCheck, Calendar, Filter, ArrowUpDown, PauseCircle, Download, Loader2, AlertCircle } from "lucide-react";
import { getStoredUser, exportTransactionsCsv } from "../services/api";
import { useToast } from "../context/ToastContext";

interface TransactionHistoryProps {
  transactions: Transaction[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({ transactions }) => {
  const { showToast } = useToast();
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === "admin";

  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [isExporting, setIsExporting] = useState(false);

  const handleQuickDaily = () => {
    setFromDate(todayIso());
    setToDate(todayIso());
  };

  const handleDownload = async () => {
    if (!fromDate || !toDate) {
      showToast("danger", "Pick a date range", "Choose both a From and To date before downloading.");
      return;
    }
    if (toDate < fromDate) {
      showToast("danger", "Invalid date range", "The To date can't be before the From date.");
      return;
    }
    setIsExporting(true);
    try {
      await exportTransactionsCsv(fromDate, toDate);
      showToast("success", "Report downloaded", `Transactions from ${fromDate} to ${toDate} saved as CSV.`);
    } catch (e) {
      console.error("Failed to export transactions:", e);
      showToast("danger", "Download failed", "Could not generate the report. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // Filtering logic
  const filtered = transactions.filter(t => {
    const matchesSearch = 
      t.transaction_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.user_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.beneficiary_id.toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesRisk = 
      riskFilter === "ALL" || 
      t.risk_level === riskFilter;
      
    const matchesStatus = 
      statusFilter === "ALL" || 
      (t.status ? t.status === statusFilter : (statusFilter === "BLOCKED" && t.is_fraud === 1) || (statusFilter === "APPROVED" && t.is_fraud === 0));
      
    return matchesSearch && matchesRisk && matchesStatus;
  });

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime();
    const dateB = new Date(b.timestamp).getTime();
    return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
  });

  // "Flagged By" shows the analyst who suspended a medium-risk case for
  // review, if any:
  // - a real analyst/admin email if someone flagged or resolved it
  // - "System (Auto)" for LOW/HIGH transactions the model decided on its own
  // - "—" for a transaction still sitting PENDING or SUSPENDED, unresolved
  const getResolvedByDisplay = (row: Transaction) => {
    if (row.resolved_by) {
      return <span className="text-dark-text font-semibold text-xs">{row.resolved_by}</span>;
    }
    if (row.status === "PENDING" || row.status === "SUSPENDED") {
      return <span className="text-dark-muted text-xs">—</span>;
    }
    return <span className="text-dark-muted text-xs">System (Auto)</span>;
  };

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

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-dark-text">Auditable Transaction Ledger</h1>
        <p className="text-dark-muted mt-1">Search, filter, and inspect historical transactional logs & decisions</p>
      </div>

      {/* Export Transaction Report - admin only */}
      {isAdmin && (
        <div className="bg-guard-orange/90 border border-guard-orange rounded-xl p-5 space-y-3 shadow-glow-brand">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <Download className="h-4 w-4" />
            Export Transaction Report
          </div>
          <div className="flex flex-col md:flex-row gap-3 items-center">
            <button
              onClick={handleQuickDaily}
              className="bg-white text-guard-orange text-xs font-bold px-4 py-2.5 rounded-lg border-2 border-white hover:bg-guard-orangeLight transition w-full md:w-auto"
            >
              Daily
            </button>
            <div className="flex items-center gap-1.5 bg-white/95 border border-white rounded-lg px-3 py-2 text-xs font-semibold text-gray-900 w-full md:w-auto">
              <Calendar className="h-3.5 w-3.5 text-gray-500" />
              From:
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="bg-transparent outline-none text-gray-900 font-semibold [color-scheme:light]"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-white/95 border border-white rounded-lg px-3 py-2 text-xs font-semibold text-gray-900 w-full md:w-auto">
              <Calendar className="h-3.5 w-3.5 text-gray-500" />
              To:
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="bg-transparent outline-none text-gray-900 font-semibold [color-scheme:light]"
              />
            </div>
            <div className="flex-1 hidden md:block" />
            <button
              onClick={handleDownload}
              disabled={isExporting}
              className="bg-[#1E293B] text-white text-xs font-bold px-5 py-2.5 rounded-lg flex items-center gap-2 hover:opacity-90 transition disabled:opacity-60 w-full md:w-auto justify-center"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Generating..." : "Download Report (CSV)"}
            </button>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-dark-card border border-dark-border p-4 rounded-xl shadow-glow-brand flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Search bar */}
        <div className="relative w-full md:w-80">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-dark-muted">
            <Search className="h-4.5 w-4.5" />
          </span>
          <input
            type="text"
            placeholder="Search amount, ID, or beneficiary..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-dark-bg border border-dark-border text-dark-text text-xs rounded-lg pl-10 pr-3 py-2.5 w-full focus:border-guard-orange focus:outline-none"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap md:flex-nowrap gap-3 w-full md:w-auto items-center">
          <div className="flex items-center gap-1.5 w-full md:w-auto">
            <Filter className="h-4 w-4 text-dark-muted" />
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-dark-bg border border-dark-border text-dark-text text-xs rounded-lg p-2.5 w-full md:w-32 focus:border-brand-primary focus:outline-none font-semibold"
            >
              <option value="ALL">All Risk levels</option>
              <option value="LOW">Low Risk</option>
              <option value="MEDIUM">Medium Risk</option>
              <option value="HIGH">High Risk</option>
            </select>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-dark-bg border border-dark-border text-dark-text text-xs rounded-lg p-2.5 w-full md:w-36 focus:border-brand-primary focus:outline-none font-semibold"
          >
            <option value="ALL">All Statuses</option>
            <option value="APPROVED">Approved Pass</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended (Pending)</option>
            <option value="BLOCKED">Blocked Fraud</option>
          </select>

          <button
            onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
            className="bg-dark-bg border border-dark-border text-dark-text text-xs rounded-lg p-2.5 flex items-center gap-1.5 transition hover:bg-dark-border/20 w-full md:w-auto justify-center"
          >
            <ArrowUpDown className="h-4 w-4" /> 
            {sortOrder === "desc" ? "Newest First" : "Oldest First"}
          </button>
        </div>
      </div>

      {/* Ledger Logs Table */}
      <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden">
        <div className="overflow-x-auto">
          {sorted.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100/70 dark:bg-dark-card text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-3 py-3">Timestamp</th>
                  <th className="px-3 py-3">Transaction ID</th>
                  <th className="px-3 py-3">User Account</th>
                  <th className="px-3 py-3">Beneficiary</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3 text-center">Score</th>
                  <th className="px-3 py-3 text-center">Risk</th>
                  <th className="px-3 py-3">Decision</th>
                  <th className="px-3 py-3">Resolved By</th>
                  <th className="px-3 py-3">Flagged By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-dark-border text-sm">
                {sorted.map((row, idx) => (
                  <tr key={idx} className="hover:bg-dark-border/10 transition">
                    <td className="px-3 py-3.5 text-xs text-dark-muted font-semibold flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(row.timestamp).toLocaleString("en-NG", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs font-semibold text-dark-text">
                      {row.transaction_id}
                    </td>
                    <td className="px-3 py-3.5 text-dark-text font-medium">{row.user_id}</td>
                    <td className="px-3 py-3.5 font-mono text-xs text-dark-muted truncate max-w-[110px]">
                      {row.beneficiary_id}
                    </td>
                    <td className="px-3 py-3.5 text-xs">
                      <span className="bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-dark-muted border border-gray-200 dark:border-dark-border px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                        {row.payment_method || "USSD"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-dark-text font-bold">
                      ₦{row.amount.toLocaleString('en-NG')}
                    </td>
                    <td className="px-3 py-3.5 text-center text-dark-text font-semibold font-mono">
                      {row.risk_score}%
                    </td>
                    <td className="px-3 py-3.5 text-center">{getRiskBadge(row.risk_level)}</td>
                    <td className="px-3 py-3.5">
                      {row.status === "PENDING" ? (
                        <span className="text-brand-info font-bold text-xs flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" /> PENDING
                        </span>
                      ) : row.status === "SUSPENDED" ? (
                        <span className="text-guard-orange font-bold text-xs flex items-center gap-1">
                          <PauseCircle className="h-3.5 w-3.5" /> SUSPENDED
                        </span>
                      ) : row.status === "BLOCKED" || row.is_fraud === 1 ? (
                        <span className="text-brand-danger font-bold text-xs flex items-center gap-1">
                          <ShieldAlert className="h-3.5 w-3.5" /> BLOCKED
                        </span>
                      ) : (
                        <span className="text-brand-success font-bold text-xs flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" /> APPROVED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      {getResolvedByDisplay(row)}
                    </td>
                    <td className="px-3 py-3.5">
                      {row.claimed_by
                        ? <span className="text-dark-text font-semibold text-xs">{row.claimed_by}</span>
                        : <span className="text-dark-muted text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-20 text-center text-dark-muted text-xs">
              No historical transactions match the search filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

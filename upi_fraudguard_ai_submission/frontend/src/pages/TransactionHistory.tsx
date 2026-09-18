import React, { useState } from "react";
import type { Transaction } from "../types";
import { Search, ShieldAlert, ShieldCheck, Calendar, Filter, ArrowUpDown } from "lucide-react";

interface TransactionHistoryProps {
  transactions: Transaction[];
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({ transactions }) => {
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
      (statusFilter === "BLOCKED" && t.is_fraud === 1) ||
      (statusFilter === "APPROVED" && t.is_fraud === 0);
      
    return matchesSearch && matchesRisk && matchesStatus;
  });

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime();
    const dateB = new Date(b.timestamp).getTime();
    return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
  });

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

      {/* Filter Toolbar */}
      <div className="bg-dark-card border border-dark-border p-4 rounded-xl shadow-glow-brand flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Search bar */}
        <div className="relative w-full md:w-80">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-dark-muted">
            <Search className="h-4.5 w-4.5" />
          </span>
          <input
            type="text"
            placeholder="Search VPA, ID, or Beneficiary..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-dark-bg border border-dark-border text-dark-text text-xs rounded-lg pl-10 pr-3 py-2.5 w-full focus:border-brand-primary focus:outline-none"
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
              <thead className="bg-gray-100/70 text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-5 py-3">Transaction ID</th>
                  <th className="px-5 py-3">User VPA</th>
                  <th className="px-5 py-3">Beneficiary</th>
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3 text-center">Score</th>
                  <th className="px-5 py-3 text-center">Risk</th>
                  <th className="px-5 py-3">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {sorted.map((row, idx) => (
                  <tr key={idx} className="hover:bg-dark-border/10 transition">
                    <td className="px-5 py-3.5 text-xs text-dark-muted font-semibold flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(row.timestamp).toLocaleString("en-IN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-dark-text">
                      {row.transaction_id}
                    </td>
                    <td className="px-5 py-3.5 text-dark-text font-medium">{row.user_id}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-dark-muted truncate max-w-[150px]">
                      {row.beneficiary_id}
                    </td>
                    <td className="px-5 py-3.5 text-xs">
                      <span className="bg-gray-100 text-gray-700 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                        {row.payment_method || "UPI"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-dark-text font-bold">
                      ₹{row.amount.toLocaleString('en-IN')}
                    </td>
                    <td className="px-5 py-3.5 text-center text-dark-text font-semibold font-mono">
                      {row.risk_score}%
                    </td>
                    <td className="px-5 py-3.5 text-center">{getRiskBadge(row.risk_level)}</td>
                    <td className="px-5 py-3.5">
                      {row.is_fraud === 1 ? (
                        <span className="text-brand-danger font-bold text-xs flex items-center gap-1">
                          <ShieldAlert className="h-3.5 w-3.5" /> BLOCKED
                        </span>
                      ) : (
                        <span className="text-brand-success font-bold text-xs flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" /> APPROVED
                        </span>
                      )}
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

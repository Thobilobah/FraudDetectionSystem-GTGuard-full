import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, MapPin, ShieldAlert, Loader2 } from "lucide-react";
import type { HeatmapPoint } from "../types";
import { getFraudHeatmap } from "../services/api";
import { NigeriaHeatmap } from "../components/NigeriaHeatmap";

const POLL_MS = 15000;

/**
 * Threat Heatmap - fraud concentration across Nigerian state capitals. Each
 * transaction is bucketed to its nearest capital server-side; this page
 * colours the capital by fraud volume (darker red = more fraud) on a real
 * Nigeria boundary map.
 */
export const ThreatHeatmap: React.FC = () => {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getFraudHeatmap();
      setPoints(data);
      setError(null);
    } catch (e) {
      console.error("Heatmap refresh failed:", e);
      setError("Could not load fraud heatmap data. Retrying shortly…");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const stats = useMemo(() => {
    const totalFraud = points.reduce((s, p) => s + p.fraud, 0);
    const totalTxns = points.reduce((s, p) => s + p.total, 0);
    const activeLocations = points.filter((p) => p.fraud > 0).length;
    const sorted = [...points].sort((a, b) => b.fraud - a.fraud);
    return {
      totalFraud,
      totalTxns,
      activeLocations,
      top: sorted.slice(0, 10),
      topState: sorted[0],
      maxFraud: sorted[0]?.fraud ?? 0,
    };
  }, [points]);

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex items-center gap-3">
        <div className="bg-brand-danger/15 border border-brand-danger/30 text-brand-danger p-2.5 rounded-xl">
          <Flame className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-dark-text">Threat Heatmap</h1>
          <p className="text-dark-muted mt-1">
            Fraud concentration by Nigerian state capital — darker red means more fraud
          </p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <span className="text-[10px] text-dark-muted uppercase font-bold tracking-wider block">
            Fraud Transactions
          </span>
          <span className="text-2xl font-extrabold text-brand-danger block mt-1">
            {stats.totalFraud.toLocaleString()}
          </span>
          <span className="text-[11px] text-dark-muted">
            of {stats.totalTxns.toLocaleString()} mapped transactions
          </span>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <span className="text-[10px] text-dark-muted uppercase font-bold tracking-wider block">
            Hotspot Locations
          </span>
          <span className="text-2xl font-extrabold text-dark-text block mt-1">
            {stats.activeLocations}
          </span>
          <span className="text-[11px] text-dark-muted">capitals with at least one fraud</span>
        </div>
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <span className="text-[10px] text-dark-muted uppercase font-bold tracking-wider block">
            Top Hotspot
          </span>
          <span className="text-2xl font-extrabold text-dark-text block mt-1 truncate">
            {stats.topState ? stats.topState.name : "—"}
          </span>
          <span className="text-[11px] text-dark-muted">
            {stats.topState
              ? `${stats.topState.state} State · ${stats.topState.fraud} fraud`
              : "No data yet"}
          </span>
        </div>
      </div>

      {error && (
        <div className="text-xs text-brand-danger bg-brand-danger/5 border border-brand-danger/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2 bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <h3 className="text-base font-semibold text-dark-text flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4 text-guard-orange" /> Nigeria Fraud Map
          </h3>
          {loading && points.length === 0 ? (
            <div className="py-20 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
              <p className="text-xs text-dark-muted mt-2">Loading heatmap…</p>
            </div>
          ) : (
            <NigeriaHeatmap points={points} />
          )}
        </div>

        {/* Top hotspots */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
          <h3 className="text-base font-semibold text-dark-text flex items-center gap-2 mb-4">
            <ShieldAlert className="h-4 w-4 text-brand-danger" /> Top 10 Hotspots
          </h3>
          {stats.top.length === 0 ? (
            <p className="text-xs text-dark-muted py-8 text-center">No fraud data yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.top.map((p, idx) => {
                const width = stats.maxFraud > 0 ? Math.max(4, (p.fraud / stats.maxFraud) * 100) : 0;
                return (
                  <div key={p.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-dark-text truncate">
                        <span className="text-dark-muted mr-1.5">{idx + 1}.</span>
                        {p.name}
                        <span className="text-dark-muted font-normal"> · {p.state}</span>
                      </span>
                      <span className="font-bold text-brand-danger shrink-0 ml-2">{p.fraud}</span>
                    </div>
                    <div className="h-1.5 bg-dark-border/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${width}%`, backgroundColor: "#DC2626" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

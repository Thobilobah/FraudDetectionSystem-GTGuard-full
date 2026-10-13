import React from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { SuspendRequestSla } from "../types";
import { Activity, Loader2 } from "lucide-react";

interface SlaPieChartProps {
  sla: SuspendRequestSla | null;
  title?: string;
  subtitle?: string;
  loading?: boolean;
}

// SLA band colors, matching the dashboard's status palette.
const SLICE_COLORS = {
  within_sla: "#22C55E", // brand-success
  at_risk: "#F59E0B", // brand-warning
  breached: "#EF4444", // brand-danger
  awaiting: "#3B82F6", // brand-info
};

/**
 * SLA distribution of account-suspension requests, bucketed by how quickly the
 * admin decided (reviewed_at - requested_at): within 30m, 30-120m (at risk)
 * or >2h (breached); still-open requests are "Awaiting review". Shared by the
 * analyst Live Monitor and the admin Review Queue.
 */
export const SlaPieChart: React.FC<SlaPieChartProps> = ({
  sla,
  title = "Account Review SLA",
  subtitle = "Admin decision latency on suspension requests",
  loading = false,
}) => {
  const data = sla
    ? [
        { key: "within_sla", name: "Within SLA (<30m)", value: sla.within_sla, color: SLICE_COLORS.within_sla },
        { key: "at_risk", name: "At risk (30–120m)", value: sla.at_risk, color: SLICE_COLORS.at_risk },
        { key: "breached", name: "Breached (>2h)", value: sla.breached, color: SLICE_COLORS.breached },
        { key: "awaiting", name: "Awaiting review", value: sla.awaiting, color: SLICE_COLORS.awaiting },
      ].filter((d) => d.value > 0)
    : [];

  const total = sla?.total ?? 0;

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-4 w-4 text-guard-orange" />
        <h3 className="text-sm font-bold text-dark-text">{title}</h3>
      </div>
      <p className="text-[11px] text-dark-muted mb-3">{subtitle}</p>

      {loading && !sla ? (
        <div className="h-[200px] flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-guard-orange" />
        </div>
      ) : total === 0 ? (
        <div className="h-[200px] flex flex-col items-center justify-center text-center text-dark-muted gap-2">
          <Activity className="h-7 w-7 text-dark-border" />
          <p className="text-xs">No suspension requests yet.</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="w-full sm:w-1/2 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#151D30", borderColor: "#222E4A", color: "#F3F4F6", fontSize: 12 }}
                  itemStyle={{ color: "#F3F4F6" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-full sm:w-1/2 space-y-2">
            <div className="text-xs text-dark-muted">
              <span className="text-2xl font-extrabold text-dark-text">{total}</span> request{total === 1 ? "" : "s"}
            </div>
            {[
              { label: "Within SLA", value: sla?.within_sla ?? 0, color: SLICE_COLORS.within_sla },
              { label: "At risk", value: sla?.at_risk ?? 0, color: SLICE_COLORS.at_risk },
              { label: "Breached", value: sla?.breached ?? 0, color: SLICE_COLORS.breached },
              { label: "Awaiting review", value: sla?.awaiting ?? 0, color: SLICE_COLORS.awaiting },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-dark-muted font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                  {row.label}
                </span>
                <span className="font-bold text-dark-text">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

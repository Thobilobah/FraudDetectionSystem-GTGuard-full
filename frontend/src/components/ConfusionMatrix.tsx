import React from "react";

interface ConfusionMatrixProps {
  tn: number;
  fp: number;
  fn: number;
  tp: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
}

interface CellProps {
  label: string;
  count: number;
  percent: number;
  caption: string;
  tone: "success" | "warning" | "danger";
}

const TONE: Record<
  CellProps["tone"],
  { border: string; label: string }
> = {
  success: { border: "border-brand-success/40", label: "text-brand-success" },
  warning: { border: "border-brand-warning/40", label: "text-brand-warning" },
  danger: { border: "border-brand-danger/40", label: "text-brand-danger" },
};

const Cell: React.FC<CellProps> = ({ label, count, percent, caption, tone }) => {
  const t = TONE[tone];
  return (
    <div
      className={`bg-gray-50 dark:bg-white/5 border ${t.border} p-4 rounded-xl text-center space-y-1.5`}
    >
      <span className={`text-[10px] font-extrabold tracking-wider block uppercase ${t.label}`}>
        {label}
      </span>
      <div className="flex items-baseline justify-center gap-2">
        <span className="text-2xl font-bold text-dark-text">{count.toLocaleString()}</span>
        <span className="text-xs font-semibold text-dark-muted">{percent.toFixed(1)}%</span>
      </div>
      <span className="text-[10px] text-dark-muted block">{caption}</span>
    </div>
  );
};

const Chip: React.FC<{ label: string; value: number; tone?: string }> = ({
  label,
  value,
  tone = "text-dark-text",
}) => (
  <div className="bg-gray-50/50 dark:bg-white/5 p-2 rounded text-center">
    <span className="text-dark-muted block font-semibold text-[10px] uppercase tracking-wide">
      {label}
    </span>
    <span className={`text-sm font-bold ${tone}`}>{(value * 100).toFixed(1)}%</span>
  </div>
);

export const ConfusionMatrix: React.FC<ConfusionMatrixProps> = ({
  tn,
  fp,
  fn,
  tp,
  accuracy,
  precision,
  recall,
  f1,
}) => {
  const total = tn + fp + fn + tp;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const metrics: { label: string; value: number; tone?: string }[] = [];
  if (accuracy !== undefined) metrics.push({ label: "Accuracy", value: accuracy });
  if (precision !== undefined) metrics.push({ label: "Precision", value: precision });
  if (recall !== undefined) metrics.push({ label: "Recall", value: recall });
  if (f1 !== undefined) metrics.push({ label: "F1", value: f1 });

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-dark-muted text-center font-semibold uppercase tracking-wide">
        Columns = model prediction · Rows = actual outcome
      </p>

      <div className="grid grid-cols-[auto_1fr_1fr] gap-2.5 items-stretch">
        {/* Column headers */}
        <div />
        <div className="text-center text-[10px] font-bold text-dark-muted uppercase tracking-wider self-end pb-1">
          Predicted: Approved
        </div>
        <div className="text-center text-[10px] font-bold text-dark-muted uppercase tracking-wider self-end pb-1">
          Predicted: Fraud
        </div>

        {/* Actual: Approved row */}
        <div className="flex items-center text-[10px] font-bold text-dark-muted uppercase tracking-wider leading-tight pr-1 w-20">
          Actual: Approved (Genuine)
        </div>
        <Cell
          label="True Negative (TN)"
          count={tn}
          percent={pct(tn)}
          caption="Genuine cleared — model agreed"
          tone="success"
        />
        <Cell
          label="False Positive (FP)"
          count={fp}
          percent={pct(fp)}
          caption="False alarm — genuine flagged"
          tone="warning"
        />

        {/* Actual: Fraud row */}
        <div className="flex items-center text-[10px] font-bold text-dark-muted uppercase tracking-wider leading-tight pr-1 w-20">
          Actual: Fraud
        </div>
        <Cell
          label="False Negative (FN)"
          count={fn}
          percent={pct(fn)}
          caption="Missed fraud — slipped through"
          tone="danger"
        />
        <Cell
          label="True Positive (TP)"
          count={tp}
          percent={pct(tp)}
          caption="Fraud caught — model agreed"
          tone="success"
        />
      </div>

      {metrics.length > 0 && (
        <div className={`grid gap-3 max-w-lg mx-auto pt-1 ${metrics.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
          {metrics.map((m) => (
            <Chip key={m.label} label={m.label} value={m.value} tone={m.tone} />
          ))}
        </div>
      )}
    </div>
  );
};

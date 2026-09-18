import React from "react";
import type { ModelMetadata, ModelComparison, FeatureImportance } from "../types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Award, Zap, BarChart3, Database } from "lucide-react";

interface ModelPerformanceProps {
  modelMeta: ModelMetadata | null;
  comparison: ModelComparison[];
  featureImportance: FeatureImportance[];
  onSelectModel?: (modelName: string) => void;
}

export const ModelPerformance: React.FC<ModelPerformanceProps> = ({ 
  modelMeta, 
  comparison, 
  featureImportance,
  onSelectModel
}) => {

  const formatPercent = (val: number) => `${(val * 100).toFixed(1)}%`;

  // Process data for charts
  const chartData = featureImportance
    .map(f => ({
      name: f.Feature,
      Importance: parseFloat(f.Importance.toFixed(4))
    }))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-dark-text">Model Performance & Analytics</h1>
        <p className="text-dark-muted mt-1">Audit statistics, feature importances, and multi-model benchmark matrices</p>
      </div>

      {modelMeta && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Active Model Summary Card */}
          <div className="bg-dark-card border border-gray-200 p-5 rounded-xl shadow-glow-brand flex flex-col justify-between md:col-span-1">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded bg-guard-orangeLight text-guard-orange">
                  <Award className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-dark-text">Active Production Model</h3>
              </div>
              <div>
                <span className="text-3xl font-extrabold text-dark-text block mt-2">{modelMeta.selected_model}</span>
                <span className="text-xs text-dark-muted block mt-1">Selected automatically on highest F1-Score</span>
              </div>
              <div className="text-xs text-dark-muted font-semibold bg-gray-50 border border-dark-border p-2.5 rounded-lg space-y-1">
                <div className="flex justify-between"><span>Trained Timestamp:</span><span className="text-dark-text font-mono">{modelMeta.training_timestamp}</span></div>
                <div className="flex justify-between"><span>Training Dataset Size:</span><span className="text-dark-text">1,000 Records</span></div>
              </div>
            </div>
            
            <div className="border-t border-gray-100 pt-4 mt-4 grid grid-cols-2 gap-3 text-center text-xs">
              <div className="bg-gray-50/50 p-2 rounded">
                <span className="text-dark-muted block font-semibold">F1 Accuracy</span>
                <span className="text-sm font-bold text-dark-text">{formatPercent(modelMeta.metrics.f1)}</span>
              </div>
              <div className="bg-gray-50/50 p-2 rounded">
                <span className="text-dark-muted block font-semibold">Recall Sensitivity</span>
                <span className="text-sm font-bold text-dark-text">{formatPercent(modelMeta.metrics.recall)}</span>
              </div>
            </div>
          </div>

          {/* Confusion Matrix Card */}
          <div className="bg-dark-card border border-dark-border p-5 rounded-xl shadow-glow-brand md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded bg-brand-warning/10 text-brand-warning">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-dark-text">Confusion Matrix (Validation Split)</h3>
                <p className="text-xs text-dark-muted">Out-of-sample predictions vs actual outcomes</p>
              </div>
            </div>

            {modelMeta.confusion_matrix ? (
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto pt-3">
                {/* TN */}
                <div className="bg-gray-50 border border-dark-border p-4 rounded-xl text-center space-y-1.5">
                  <span className="text-[10px] text-brand-success font-extrabold tracking-wider block uppercase">True Negative (TN)</span>
                  <span className="text-2xl font-bold text-dark-text">{modelMeta.confusion_matrix[0][0]}</span>
                  <span className="text-[10px] text-dark-muted block">Genuine correctly flagged</span>
                </div>
                {/* FP */}
                <div className="bg-gray-50 border border-brand-warning/20 p-4 rounded-xl text-center space-y-1.5">
                  <span className="text-[10px] text-brand-warning font-extrabold tracking-wider block uppercase">False Positive (FP)</span>
                  <span className="text-2xl font-bold text-dark-text">{modelMeta.confusion_matrix[0][1]}</span>
                  <span className="text-[10px] text-dark-muted block">Genuine blocked (friction)</span>
                </div>
                {/* FN */}
                <div className="bg-gray-50 border border-brand-danger/20 p-4 rounded-xl text-center space-y-1.5">
                  <span className="text-[10px] text-brand-danger/60 font-extrabold tracking-wider block uppercase">False Negative (FN)</span>
                  <span className="text-2xl font-bold text-dark-text">{modelMeta.confusion_matrix[1][0]}</span>
                  <span className="text-[10px] text-dark-muted block">Fraud slipped through</span>
                </div>
                {/* TP */}
                <div className="bg-gray-50 border border-brand-success/40 p-4 rounded-xl text-center space-y-1.5">
                  <span className="text-[10px] text-brand-success font-extrabold tracking-wider block uppercase">True Positive (TP)</span>
                  <span className="text-2xl font-bold text-dark-text">{modelMeta.confusion_matrix[1][1]}</span>
                  <span className="text-[10px] text-dark-muted block">Fraud successfully blocked</span>
                </div>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-dark-muted text-xs">
                Confusion matrix details not available.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Model Benchmark Table */}
      <div className="bg-dark-card border border-dark-border rounded-xl shadow-glow-brand overflow-hidden">
        <div className="px-5 py-4 border-b border-dark-border flex items-center gap-2">
          <Zap className="h-5 w-5 text-guard-orange" />
          <h3 className="text-lg font-semibold text-dark-text">Full Model Comparison Benchmarks</h3>
        </div>
        
        <div className="overflow-x-auto">
          {comparison.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100/70 text-[11px] text-dark-muted uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-5 py-3">Classifier</th>
                  <th className="px-5 py-3 text-center">F1 Score</th>
                  <th className="px-5 py-3 text-center">Recall (Target)</th>
                  <th className="px-5 py-3 text-center">ROC-AUC</th>
                  <th className="px-5 py-3 text-center">Precision</th>
                  <th className="px-5 py-3 text-center">Accuracy</th>
                  <th className="px-5 py-3 text-center">Training Time</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {comparison.map((row, idx) => {
                  const isSelected = modelMeta?.selected_model === row.Model;
                  return (
                    <tr 
                      key={idx} 
                      className={`hover:bg-dark-border/10 transition ${
                        isSelected ? "bg-guard-orangeLight font-semibold border-l-4 border-l-guard-orange" : ""
                      }`}
                    >
                      <td className="px-5 py-3.5 text-dark-text flex items-center gap-2">
                        {row.Model}
                      </td>
                      <td className="px-5 py-3.5 text-center text-dark-text">{formatPercent(row.F1)}</td>
                      <td className="px-5 py-3.5 text-center text-dark-text">{formatPercent(row.Recall)}</td>
                      <td className="px-5 py-3.5 text-center text-dark-text">{formatPercent(row["ROC-AUC"])}</td>
                      <td className="px-5 py-3.5 text-center text-dark-text">{formatPercent(row.Precision)}</td>
                      <td className="px-5 py-3.5 text-center text-dark-text">{formatPercent(row.Accuracy)}</td>
                      <td className="px-5 py-3.5 text-center text-xs font-mono text-dark-muted">
                        {row["Training Time (s)"].toFixed(4)}s
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {isSelected ? (
                          <span className="text-brand-success text-xs font-bold bg-brand-success/15 border border-brand-success/20 px-2.5 py-1 rounded">
                            Active
                          </span>
                        ) : (
                          <button
                            onClick={() => onSelectModel && onSelectModel(row.Model)}
                            className="bg-guard-orange hover:bg-guard-orange/90 text-white text-xs font-bold px-2.5 py-1 rounded transition hover:scale-[1.05]"
                          >
                            Activate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center text-dark-muted text-xs">
              Benchmark comparison report not found. Compile the ML pipeline.
            </div>
          )}
        </div>
      </div>

      {/* Feature Importance Chart */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-5 shadow-glow-brand">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-5 w-5 text-guard-orange" />
          <div>
            <h3 className="text-lg font-semibold text-dark-text">Top 10 Feature Importances</h3>
            <p className="text-xs text-dark-muted">Dynamic contribution weightings evaluated by the classifier</p>
          </div>
        </div>

        <div className="h-80 w-full pt-2">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 40, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" stroke="#9CA3AF" fontSize={11} />
                <YAxis dataKey="name" type="category" stroke="#9CA3AF" fontSize={11} width={150} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#151D30", borderColor: "#222E4A", color: "#F3F4F6" }} 
                  itemStyle={{ color: "#F3F4F6" }}
                />
                <Bar dataKey="Importance" fill="#2563EB" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-dark-muted text-xs">
              Feature importances chart not available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

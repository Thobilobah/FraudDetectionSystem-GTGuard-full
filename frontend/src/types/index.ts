export interface TriggeredRule {
  rule_id: string;
  rule_name: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface Transaction {
  transaction_id: string;
  user_id: string;
  amount: number;
  transaction_type: string;
  timestamp: string;
  beneficiary_id: string;
  device_id: string;
  location_latitude: number;
  location_longitude: number;
  is_fraud: number | null;
  fraud_probability: number | null;
  risk_score: number | null;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  triggered_rules: TriggeredRule[];
  created_at: string;
  payment_method?: string;
  status?: "APPROVED" | "BLOCKED" | "PENDING" | "SUSPENDED" | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  required_action?: "USER_AUTH" | null;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export type SuspendRequestStatus = "PENDING" | "APPROVED" | "WATCHLISTED" | "DECLINED";

export interface AccountSuspendRequest {
  request_id: string;
  account_id: string;
  source_txn_id: string | null;
  requested_by: string;
  requested_at: string;
  note: string | null;
  status: SuspendRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // Joined from the source transaction for context.
  source_amount?: number | null;
  source_risk_score?: number | null;
  source_risk_level?: "LOW" | "MEDIUM" | "HIGH" | null;
  source_created_at?: string | null;
}

export interface SuspendRequestPage {
  items: AccountSuspendRequest[];
  total: number;
  limit: number;
  offset: number;
}

export interface SuspendRequestSla {
  awaiting: number;
  approved: number;
  watchlisted: number;
  declined: number;
  within_sla: number;
  at_risk: number;
  breached: number;
  total: number;
}

export interface BlockedAccount {
  account_id: string;
  reason: string | null;
  source_txn_id: string | null;
  blocked_by: string;
  blocked_at: string;
  active: number;
}

export interface WatchlistedAccount {
  account_id: string;
  reason: string | null;
  source_txn_id: string | null;
  watched_by: string;
  watched_at: string;
  active: number;
}

/** Fraud concentration at a Nigerian state capital (Threat Heatmap). */
export interface HeatmapPoint {
  name: string;
  state: string;
  total: number;
  fraud: number;
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number;
  training_time: number;
}

export interface ModelMetadata {
  selected_model: string;
  metrics: ModelMetrics;
  confusion_matrix: number[][];
  training_timestamp: string;
}

export interface ModelComparison {
  Model: string;
  Accuracy: number;
  Precision: number;
  Recall: number;
  F1: number;
  "ROC-AUC": number;
  "Training Time (s)": number;
  "Confusion Matrix": string;
}

export interface FeatureImportance {
  Feature: string;
  Importance: number;
}

export interface RealTimeMetrics {
  total_transactions: number;
  fraud_transactions: number;
  genuine_transactions: number;
  fraud_percentage: number;
  high_risk_transactions: number;
  hourly_trend: {
    hour: string;
    count: number;
    fraud_count: number;
  }[];
}

export interface AnalyticsResponse {
  real_time_metrics: RealTimeMetrics;
  model_metadata: ModelMetadata | null;
  model_comparison: ModelComparison[];
  feature_importance: FeatureImportance[];
}

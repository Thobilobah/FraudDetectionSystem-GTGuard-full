import axios from "axios";
import type { Transaction, TransactionPage, AnalyticsResponse } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const TOKEN_KEY = "fraudguard_token";
const USER_KEY = "fraudguard_user";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach the signed-in user's token to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the backend rejects the token (expired / missing), drop the session
// and let App.tsx fall back to the login screen - but ONLY when the failed
// request actually carried the current session's own token. The background
// simulation stream may still be sending an older token it captured when it
// started; a 401 from that stale token must not kick a freshly signed-in
// user back to the login screen.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const headers = error?.config?.headers;
      const usedAuth =
        typeof headers?.get === "function"
          ? headers.get("Authorization")
          : headers?.Authorization;
      const sessionToken = localStorage.getItem(TOKEN_KEY);
      if (!sessionToken || !usedAuth || usedAuth === `Bearer ${sessionToken}`) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        window.dispatchEvent(new Event("fraudguard:logout"));
      }
    }
    return Promise.reject(error);
  }
);

export interface AuthUser {
  email: string;
  name: string;
  role: string; // "admin" or "analyst" - determines resolve/claim permissions
}

export const login = async (email: string, password: string): Promise<AuthUser> => {
  const response = await api.post("/auth/login", { email, password });
  localStorage.setItem(TOKEN_KEY, response.data.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
  return response.data.user;
};

export const logout = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const isAuthenticated = (): boolean => !!localStorage.getItem(TOKEN_KEY);

// Used by the background simulation stream: it captures the token once when
// it starts and sends it explicitly, so it can keep generating transactions
// after the user logs out (the request interceptor still prefers the live
// session token whenever the user is signed in).
export const getSessionToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const getStoredUser = (): AuthUser | null => {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};

export const getHealth = async () => {
  const response = await api.get("/health");
  return response.data;
};

export const getModelInfo = async () => {
  const response = await api.get("/model-info");
  return response.data;
};

export const getFeatureExplanation = async () => {
  const response = await api.get("/feature-explanation");
  return response.data;
};

export const getAnalytics = async (): Promise<AnalyticsResponse> => {
  const response = await api.get("/analytics");
  return response.data;
};

export const getTransactions = async (limit = 100): Promise<Transaction[]> => {
  const response = await api.get(`/transactions?limit=${limit}`);
  // The endpoint now returns { items, total, limit, offset }; unwrap items so
  // the shared poll cache keeps producing a plain array for the dashboard.
  const data = response.data;
  return Array.isArray(data) ? data : (data.items ?? []);
};

export interface TransactionPageParams {
  limit?: number;
  offset?: number;
  search?: string;
  risk_level?: string;
  status?: string;
  sort?: "desc" | "asc" | "risk";
  flagged_by?: string;
  payment_method?: string;
  location?: string;
}

export const getTransactionsPage = async (params: TransactionPageParams = {}): Promise<TransactionPage> => {
  const response = await api.get("/transactions", { params });
  return response.data;
};

export const predictTransaction = async (transaction: Omit<Transaction, "transaction_id" | "is_fraud" | "fraud_probability" | "risk_score" | "risk_level" | "triggered_rules" | "created_at">): Promise<Transaction> => {
  const response = await api.post("/predict", transaction);
  return response.data;
};

export const predictFeatures = async (features: Record<string, any>, authToken?: string | null) => {
  const response = await api.post("/predict/features", features, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  return response.data;
};

export const generateDemoTransaction = async (
  scenario: "normal" | "suspicious" | "high_risk",
  authToken?: string | null
) => {
  const response = await api.post(`/demo/generate?scenario=${scenario}`, null, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  return response.data;
};

export const selectActiveModel = async (modelName: string) => {
  const response = await api.post(`/model/select?model_name=${encodeURIComponent(modelName)}`);
  return response.data;
};

export const resolveTransaction = async (
  transactionId: string,
  decision: "APPROVED" | "BLOCKED"
): Promise<Transaction> => {
  const response = await api.patch(`/transactions/${transactionId}/resolve`, { decision });
  return response.data;
};

export const suspendTransaction = async (transactionId: string): Promise<Transaction> => {
  const response = await api.patch(`/transactions/${transactionId}/suspend`);
  return response.data;
};

/**
 * Simulate the customer clearing an "awaiting user authentication" hold on a
 * MEDIUM 40-45 transaction (OTP/biometric in production) -> APPROVED. Without
 * it the auth-timeout sweep blocks the transaction after 15 minutes.
 */
export const authenticateTransaction = async (transactionId: string): Promise<Transaction> => {
  const response = await api.post(`/transactions/${transactionId}/authenticate`);
  return response.data;
};

/**
 * Fetch a single transaction with fresh stamps (claimed/resolved) and parsed
 * rules - used when opening the Review Queue detail modal so the analysis
 * always reflects the latest state, not a stale table row.
 */
export const getTransactionById = async (transactionId: string): Promise<Transaction> => {
  const response = await api.get(`/transactions/${encodeURIComponent(transactionId)}`);
  return response.data;
};

export interface BulkResult {
  succeeded: string[];
  failed: { transaction_id: string; reason: string }[];
}

/** Analyst batch-flag: same semantics as suspendTransaction, per row. */
export const bulkSuspendTransactions = async (transactionIds: string[]): Promise<BulkResult> => {
  const response = await api.post("/transactions/bulk-suspend", {
    transaction_ids: transactionIds,
  });
  return response.data;
};

/** Admin batch decision over up to 100 PENDING/SUSPENDED rows. */
export const bulkResolveTransactions = async (
  transactionIds: string[],
  decision: "APPROVED" | "BLOCKED"
): Promise<BulkResult> => {
  const response = await api.post("/transactions/bulk-resolve", {
    transaction_ids: transactionIds,
    decision,
  });
  return response.data;
};

export interface QueueMetrics {
  pending: number;
  oldest_pending_minutes: number;
  completed_total: number;
  resolved_total: number;
  resolved_24h: number;
  auto_resolved_24h: number;
  median_resolve_minutes: number;
}

/** Admin backlog/throughput stats (badge, dashboard card, metrics strip). */
export const getQueueMetrics = async (): Promise<QueueMetrics> => {
  const response = await api.get("/transactions/queue-metrics");
  return response.data;
};

/**
 * Trigger the auth-timeout sweep. Unauthenticated MEDIUM 40-45 holds past
 * their 15-minute lifespan are BLOCKED. The server throttles itself to one
 * real sweep per minute, so polling this is cheap.
 */
export const runAutoResolve = async (): Promise<{ skipped?: boolean; resolved?: number }> => {
  const response = await api.post("/transactions/auto-resolve-run");
  return response.data;
};

export interface RecentOutcomes {
  risk_level: string;
  days: number;
  total: number;
  approved: number;
  blocked: number;
  auto_resolved: number;
  analyst_flagged: number;
  still_pending: number;
}

/** Decision support: how similar-risk transactions resolved recently. */
export const getRecentOutcomes = async (
  riskLevel: string,
  days = 7
): Promise<RecentOutcomes> => {
  const response = await api.get("/transactions/outcomes", {
    params: { risk_level: riskLevel, days },
  });
  return response.data;
};

export interface FeedbackConfusionMatrix {
  days: number | null;
  total: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  analyst_flagged: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Live confusion matrix from human decisions (admin): analyst resolve
 * verdicts as ground truth vs the model_prediction snapshot, over ALL
 * transaction history by default (omit `days` for full history, or pass
 * a positive int for a rolling window). Excludes system decisions
 * (system:policy, system:auth-timeout) and customer:auth - only human
 * feedback counts.
 */
export const getFeedbackConfusionMatrix = async (
  days?: number
): Promise<FeedbackConfusionMatrix> => {
  const response = await api.get("/transactions/confusion-matrix", {
    params: days ? { days } : {},
  });
  return response.data;
};

export interface ExportTransactionsParams {
  /** Optional ISO dates - omit both for no date limit. */
  startDate?: string;
  endDate?: string;
  /** Active toolbar filters; omit any to export everything in scope. */
  search?: string;
  riskLevel?: string;
  status?: string;
  method?: string;
  location?: string;
}

const exportSlug = (value: string): string =>
  value.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

/** Filename mirrors the backend's: scope = dates + active filters. */
export const buildExportFilename = (p: ExportTransactionsParams): string => {
  const scope: string[] = [p.startDate && p.endDate ? `${p.startDate}_to_${p.endDate}` : "all-dates"];
  const parts: Array<[string, string | undefined]> = [
    ["q", p.search],
    ["risk", p.riskLevel],
    ["status", p.status],
    ["method", p.method],
    ["location", p.location],
  ];
  for (const [label, value] of parts) {
    if (value) scope.push(`${label}-${exportSlug(value)}`);
  }
  return `gt-guard-transactions_${scope.join("_")}.csv`;
};

/**
 * Admin-only: downloads a CSV of exactly what the Transaction History page
 * shows - all active toolbar filters plus an OPTIONAL From/To date range
 * (omit both dates for all of matching history) - and triggers a browser
 * save-as, so an admin can see who claimed/resolved every selected row
 * without needing to open the dashboard.
 */
export const exportTransactionsCsv = async (params: ExportTransactionsParams): Promise<void> => {
  const query: Record<string, string> = {};
  if (params.startDate) query.start_date = params.startDate;
  if (params.endDate) query.end_date = params.endDate;
  if (params.search) query.search = params.search;
  if (params.riskLevel) query.risk_level = params.riskLevel;
  if (params.status) query.status = params.status;
  if (params.method) query.payment_method = params.method;
  if (params.location) query.location = params.location;

  const response = await api.get("/transactions/export", {
    params: query,
    responseType: "blob",
  });

  const blob = new Blob([response.data], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildExportFilename(params);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};


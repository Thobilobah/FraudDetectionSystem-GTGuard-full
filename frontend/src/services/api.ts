import axios from "axios";
import type { Transaction, AnalyticsResponse } from "../types";

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
// and let App.tsx fall back to the login screen.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.dispatchEvent(new Event("fraudguard:logout"));
    }
    return Promise.reject(error);
  }
);

export interface AuthUser {
  email: string;
  name: string;
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
  return response.data;
};

export const predictTransaction = async (transaction: Omit<Transaction, "transaction_id" | "is_fraud" | "fraud_probability" | "risk_score" | "risk_level" | "triggered_rules" | "created_at">): Promise<Transaction> => {
  const response = await api.post("/predict", transaction);
  return response.data;
};

export const predictFeatures = async (features: Record<string, any>) => {
  const response = await api.post("/predict/features", features);
  return response.data;
};

export const generateDemoTransaction = async (scenario: "normal" | "suspicious" | "high_risk") => {
  const response = await api.post(`/demo/generate?scenario=${scenario}`);
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


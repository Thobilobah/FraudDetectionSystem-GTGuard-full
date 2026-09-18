import axios from "axios";
import type { Transaction, AnalyticsResponse } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

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


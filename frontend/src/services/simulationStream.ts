// Module-level real-time simulation stream.
//
// The loop deliberately lives OUTSIDE any React component: navigating away
// from the Transaction Analyzer unmounts the page, but this module (and its
// running loop) survives for the whole SPA session, so the stream keeps
// generating transactions until the user presses Stop - exactly like a
// background feed. Only a full page reload ends it (all JS state resets).

import { generateDemoTransaction, predictFeatures, getSessionToken } from "./api";

export interface SimRow {
  transaction_id: string;
  user_id: string;
  amount: number;
  risk_level: string;
  risk_score: number | null;
  status: string;
  at: Date;
}

export interface SimState {
  running: boolean;
  feed: SimRow[];
  stats: { total: number; LOW: number; MEDIUM: number; HIGH: number };
}

let state: SimState = {
  running: false,
  feed: [],
  stats: { total: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
};

const listeners = new Set<() => void>();
// Registered by the analyzer page while it is mounted, so auto-stop errors
// still toast when the user is on the page (a silent background stop is
// surfaced by the Start button reappearing when they return).
let autoStopHandler: ((message: string) => void) | null = null;
// Monotonic token: Stop->Start (or a stale loop waking from sleep) always
// orphans the previous loop instead of running two streams at once.
let loopToken = 0;

const emit = () => listeners.forEach((listener) => listener());

const patch = (next: Partial<SimState>) => {
  state = { ...state, ...next };
  emit();
};

export const subscribeSimulation = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSimulationState = (): SimState => state;

export const setAutoStopHandler = (
  handler: ((message: string) => void) | null
): void => {
  autoStopHandler = handler;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// Weighted scenario pick: mostly genuine traffic, a decent slice of
// suspicious events, occasional outright fraud attempts.
const pickRandomScenario = (): "normal" | "suspicious" | "high_risk" => {
  const roll = Math.random() * 100;
  if (roll < 50) return "normal";
  if (roll < 80) return "suspicious";
  return "high_risk";
};

export const stopSimulation = (): void => {
  if (!state.running) return;
  // No token bump: an in-flight tick is allowed to finish and land in the
  // feed, then the loop sees running=false and exits on its own.
  patch({ running: false });
};

export const startSimulation = async (): Promise<void> => {
  if (state.running) return;
  const token = ++loopToken;
  // Capture the session token once so the stream can keep generating
  // transactions after the user logs out (logout clears localStorage, which
  // would otherwise strip the auth header and 401 the loop to death). While
  // the user is signed in, the axios interceptor prefers the live session
  // token over this captured one; after logout this captured token carries
  // the stream (valid for the JWT's 24h lifetime). Once the user logs back
  // in, running is still true, so the Stop button works immediately.
  const authToken = getSessionToken();
  patch({
    running: true,
    feed: [],
    stats: { total: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
  });
  let consecutiveFailures = 0;

  while (state.running && loopToken === token) {
    try {
      const scenario = pickRandomScenario();
      const data = await generateDemoTransaction(scenario, authToken);
      const result = await predictFeatures(
        {
          ...(data.engineered_features || {}),
          user_id: data.user_id,
          beneficiary_id: data.beneficiary_id,
          device_id: data.device_id,
          timestamp: data.timestamp,
          location_latitude: data.location_latitude,
          location_longitude: data.location_longitude,
          payment_method: data.payment_method,
        },
        authToken
      );

      // A restart happened while we were waiting: this row belongs to the
      // orphaned run, so drop it from the UI (it is still in the DB).
      if (loopToken !== token) break;

      consecutiveFailures = 0;
      const level = (result.risk_level || "LOW").toUpperCase();
      const row: SimRow = {
        transaction_id: result.transaction_id || "txn_unknown",
        user_id: data.user_id,
        amount: data.amount,
        risk_level: level,
        risk_score: result.risk_score ?? null,
        status: result.status || "APPROVED",
        at: new Date(),
      };
      patch({
        feed: [row, ...state.feed].slice(0, 20),
        stats: {
          total: state.stats.total + 1,
          LOW: state.stats.LOW + (level === "LOW" ? 1 : 0),
          MEDIUM: state.stats.MEDIUM + (level === "MEDIUM" ? 1 : 0),
          HIGH: state.stats.HIGH + (level === "HIGH" ? 1 : 0),
        },
      });
    } catch (e) {
      // A stale loop must never stop a newer run.
      if (loopToken !== token) break;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        patch({ running: false });
        autoStopHandler?.(
          "The stream hit repeated errors (rate limit or server issue) and stopped automatically."
        );
        break;
      }
    }
    if (state.running && loopToken === token) {
      await sleep(5000);
    }
  }
};

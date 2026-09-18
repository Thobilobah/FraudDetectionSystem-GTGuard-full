import React, { useState } from "react";
import { Shield, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { login } from "../services/api";

interface LoginProps {
  onLoginSuccess: () => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter both your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      onLoginSuccess();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(detail || "Unable to sign in. Please check your details and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-white">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[38%] xl:w-[35%] bg-guard-panel text-white flex-col justify-between px-12 py-14">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-guard-orange flex items-center justify-center shrink-0">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-lg leading-tight">GT GUARD</div>
            <div className="text-xs text-white/40">Powered by GTCO</div>
          </div>
        </div>

        <div className="space-y-5">
          <h1 className="text-3xl xl:text-[34px] font-bold leading-tight">
            Real-time fraud intelligence for every transaction.
          </h1>
          <p className="text-sm text-white/60 leading-relaxed max-w-md">
            Every payment is scored, monitored, and protected the moment it happens — powered by
            machine learning built for African payment rails.
          </p>

          <div className="flex gap-3.5 pt-2">
            <div className="flex-1 rounded-xl bg-white/5 border border-guard-panelBorder px-4 py-4">
              <div className="text-guard-orange font-bold text-lg">99.2%</div>
              <div className="text-white/50 text-xs mt-1 leading-snug">Detection Accuracy</div>
            </div>
            <div className="flex-1 rounded-xl bg-white/5 border border-guard-panelBorder px-4 py-4">
              <div className="text-guard-orange font-bold text-lg">&lt;50ms</div>
              <div className="text-white/50 text-xs mt-1 leading-snug">Model Response Time</div>
            </div>
            <div className="flex-1 rounded-xl bg-white/5 border border-guard-panelBorder px-4 py-4">
              <div className="text-guard-orange font-bold text-lg">24/7</div>
              <div className="text-white/50 text-xs mt-1 leading-snug">Live Surveillance</div>
            </div>
          </div>
        </div>

        <div className="text-xs text-white/30">© 2026 GT GUARD. All rights reserved.</div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-14 bg-white">
        <div className="w-full max-w-[420px]">
          {/* Mobile-only compact logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-xl bg-guard-orange flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-dark-text">GT GUARD</div>
              <div className="text-[11px] text-dark-muted">Powered by GTCO</div>
            </div>
          </div>

          <h2 className="text-3xl font-bold text-dark-text">Welcome back</h2>
          <p className="text-sm text-dark-muted mt-2 mb-7">
            Sign in to access the Risk Intelligence Dashboard
          </p>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <AlertCircle className="h-4 w-4 text-brand-danger shrink-0 mt-0.5" />
              <span className="text-sm text-brand-danger font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-dark-text mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gtbank.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl bg-gray-50 border border-dark-border text-sm text-dark-text placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-guard-orange/40 focus:border-guard-orange transition"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-dark-text">Password</label>
                <button
                  type="button"
                  className="text-sm font-semibold text-guard-orange hover:underline"
                  tabIndex={-1}
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-11 py-3.5 rounded-xl bg-gray-50 border border-dark-border text-sm text-dark-text placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-guard-orange/40 focus:border-guard-orange transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-dark-text"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded accent-guard-orange"
              />
              <span className="text-sm font-medium text-dark-muted">Remember me for 30 days</span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1A1D24] hover:bg-black text-white text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign In <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-dark-border" />
            <span className="text-xs font-bold text-gray-400">OR</span>
            <div className="h-px flex-1 bg-dark-border" />
          </div>

          <button
            type="button"
            className="w-full py-3.5 rounded-xl border border-dark-border text-sm font-semibold text-dark-text hover:bg-gray-50 transition"
          >
            Continue with Company SSO
          </button>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3.5">
            <span className="h-2 w-2 rounded-full bg-brand-warning mt-1.5 shrink-0" />
            <span className="text-sm font-semibold text-amber-700 leading-snug">
              Demo mode enabled — use any email and password to continue.
            </span>
          </div>

          <div className="flex items-center justify-center gap-2 mt-7 text-xs font-medium text-gray-400">
            <Shield className="h-3.5 w-3.5" /> Powered by GTCO AI
          </div>
        </div>
      </div>
    </div>
  );
}

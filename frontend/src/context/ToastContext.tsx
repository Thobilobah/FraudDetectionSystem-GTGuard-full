import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, PauseCircle, ShieldAlert, XCircle } from "lucide-react";

export type ToastType = "success" | "suspended" | "danger";

interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const AUTO_DISMISS_MS = 4000;

const TOAST_STYLES: Record<
  ToastType,
  { icon: React.ElementType; iconBg: string; iconColor: string; border: string }
> = {
  success: {
    icon: CheckCircle2,
    iconBg: "bg-brand-success/15",
    iconColor: "text-brand-success",
    border: "border-brand-success/30",
  },
  suspended: {
    icon: PauseCircle,
    iconBg: "bg-guard-orangeLight",
    iconColor: "text-guard-orange",
    border: "border-guard-orange/30",
  },
  danger: {
    icon: ShieldAlert,
    iconBg: "bg-brand-danger/15",
    iconColor: "text-brand-danger",
    border: "border-brand-danger/30",
  },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, title: string, message?: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-5 right-5 z-[100] flex flex-col gap-3 w-[340px] pointer-events-none">
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          const Icon = style.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-white dark:bg-dark-card border ${style.border} rounded-xl shadow-lg p-4 flex items-start gap-3 animate-[toast-in_0.25s_ease-out]`}
            >
              <div className={`h-9 w-9 rounded-full ${style.iconBg} flex items-center justify-center shrink-0`}>
                <Icon className={`h-5 w-5 ${style.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-dark-text">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-dark-muted mt-0.5 leading-relaxed">{toast.message}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="text-dark-muted hover:text-dark-text transition shrink-0"
                aria-label="Dismiss"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

import React from "react";
import { useTheme } from "../context/ThemeContext";

interface FraudGaugeProps {
  /** Fraud probability as a 0-100 percentage */
  percentage: number;
  /** Drives the ring color - LOW=green, MEDIUM=amber, HIGH=red */
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | string;
  size?: number;
}

const RING_COLORS_LIGHT: Record<string, { ring: string; track: string }> = {
  LOW: { ring: "#10B981", track: "#D1FAE5" },
  MEDIUM: { ring: "#F59E0B", track: "#FDE9C8" },
  HIGH: { ring: "#EF4444", track: "#FCA5A5" },
};

const RING_COLORS_DARK: Record<string, { ring: string; track: string }> = {
  LOW: { ring: "#34D399", track: "#134E3A" },
  MEDIUM: { ring: "#FBBF24", track: "#4A3510" },
  HIGH: { ring: "#F87171", track: "#4C1D1D" },
};

export const FraudGauge: React.FC<FraudGaugeProps> = ({ percentage, riskLevel, size = 140 }) => {
  const { theme } = useTheme();
  const clamped = Math.max(0, Math.min(100, percentage));
  const palette = theme === "dark" ? RING_COLORS_DARK : RING_COLORS_LIGHT;
  const colors = palette[riskLevel] || palette.LOW;

  const strokeWidth = size * 0.16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track (unfilled portion) */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={colors.track}
          strokeWidth={strokeWidth}
        />
        {/* Progress (filled portion), starting at 12 o'clock, filling clockwise */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={colors.ring}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-extrabold text-dark-text" style={{ fontSize: size * 0.19 }}>
          {clamped.toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

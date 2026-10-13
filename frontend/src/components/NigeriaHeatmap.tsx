import React, { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { Loader2 } from "lucide-react";
import type { HeatmapPoint } from "../types";
import { NIGERIAN_PLACES } from "../utils/nigeriaPlaces";

const MAP_WIDTH = 760;
const MAP_HEIGHT = 600;
const GEO_URL = `${import.meta.env.BASE_URL}nigeria-states.geojson`;

// Fraud-intensity ramp: light rose -> deep maroon. More fraud => darker red.
const HEAT_STOPS: [number, number, number][] = [
  [254, 202, 202],
  [252, 165, 165],
  [248, 113, 113],
  [220, 38, 38],
  [127, 29, 29],
];

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const heatColor = (intensity: number): string => {
  const t = Math.max(0, Math.min(1, intensity));
  const seg = t * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(seg));
  const local = seg - i;
  const a = HEAT_STOPS[i];
  const b = HEAT_STOPS[i + 1];
  return `rgb(${lerp(a[0], b[0], local)}, ${lerp(a[1], b[1], local)}, ${lerp(a[2], b[2], local)})`;
};

const GRADIENT = `linear-gradient(to right, ${HEAT_STOPS.map(
  (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`
).join(", ")})`;

// The boundaries file is large and never changes between mounts, so cache the
// parsed object at module scope instead of re-fetching it on every tab visit.
let geoCache: GeoJSON.FeatureCollection | null = null;

const placeCoords = (() => {
  const map: Record<string, { lat: number; lon: number }> = {};
  for (const p of NIGERIAN_PLACES) map[p.name] = { lat: p.lat, lon: p.lon };
  return map;
})();

interface NigeriaHeatmapProps {
  points: HeatmapPoint[];
}

export const NigeriaHeatmap: React.FC<NigeriaHeatmapProps> = ({ points }) => {
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(geoCache);
  const [geoError, setGeoError] = useState(false);

  useEffect(() => {
    if (geoCache) return;
    let cancelled = false;
    fetch(GEO_URL, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        geoCache = data;
        setGeo(data);
      })
      .catch((e) => {
        console.error("Nigeria boundaries load failed:", e);
        if (!cancelled) setGeoError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const maxFraud = useMemo(
    () => points.reduce((m, p) => Math.max(m, p.fraud), 0),
    [points]
  );

  const { marks, labels } = useMemo(() => {
    const marks: { key: string; lon: number; lat: number; r: number; color: string; active: boolean; title: string; name: string }[] = [];
    const labels: { key: string; lon: number; lat: number; y: number; name: string }[] = [];
    for (const p of points) {
      const c = placeCoords[p.name];
      if (!c) continue;
      const intensity = maxFraud > 0 ? p.fraud / maxFraud : 0;
      const active = p.fraud > 0;
      const r = active ? 3.5 + intensity * 7 : 2.5;
      marks.push({
        key: p.name,
        lon: c.lon,
        lat: c.lat,
        r,
        color: active ? heatColor(intensity) : "#94A3B8",
        active,
        title: `${p.name}, ${p.state} State — ${p.fraud} fraud / ${p.total} txns`,
        name: p.name,
      });
      if (active) labels.push({ key: p.name, lon: c.lon, lat: c.lat, y: -r - 4, name: p.name });
    }
    return { marks, labels: labels };
  }, [points, maxFraud]);

  if (geoError) {
    return (
      <div className="py-20 text-center text-xs text-brand-danger">
        Could not load the Nigeria map boundaries.
      </div>
    );
  }

  if (!geo) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-guard-orange mx-auto" />
        <p className="text-xs text-dark-muted mt-2">Loading map…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ComposableMap
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        projection="geoMercator"
        projectionConfig={{ center: [8.6, 9.15], scale: 3300 }}
        className="w-full h-auto"
      >
        <Geographies geography={geo}>
          {({ geographies }) =>
            geographies.map((g) => (
              <Geography
                key={g.rsmKey}
                geography={g}
                className="fill-slate-200 dark:fill-[#20242d] stroke-slate-400 dark:stroke-dark-bg outline-none"
                strokeWidth={0.5}
                style={{
                  outline: "none",
                  default: { outline: "none" },
                  hover: { outline: "none" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {marks.map((m) => (
          <Marker key={m.key} coordinates={[m.lon, m.lat]}>
            {m.active && <circle r={m.r + 5} fill={m.color} opacity={0.18} />}
            <circle
              r={m.r}
              fill={m.color}
              fillOpacity={m.active ? 0.92 : 0.5}
              stroke="#ffffff"
              strokeWidth={0.6}
            />
            <title>{m.title}</title>
          </Marker>
        ))}

        {labels.map((l) => (
          <Marker key={`label-${l.key}`} coordinates={[l.lon, l.lat]}>
            <text
              textAnchor="middle"
              y={l.y}
              className="fill-slate-600 dark:fill-dark-muted"
              style={{ fontSize: 9, fontWeight: 600, pointerEvents: "none" }}
            >
              {l.name}
            </text>
          </Marker>
        ))}
      </ComposableMap>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[11px] font-semibold text-dark-muted">
        <span className="whitespace-nowrap">Low fraud</span>
        <div className="h-2.5 flex-1 rounded-full border border-dark-border" style={{ background: GRADIENT }} />
        <span className="whitespace-nowrap">High fraud</span>
      </div>
      <p className="text-[11px] text-dark-muted">
        Darker red = more fraud transactions bucketed to that location. Grey dots
        are locations that have transactions but no fraud yet.
      </p>
    </div>
  );
};

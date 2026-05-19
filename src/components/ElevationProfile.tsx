import { useMemo } from "react";
import {
  formatDistance,
  formatElevation,
  usePreferencesStore,
} from "../state/preferences";
import { useRouteStore } from "../state/routeStore";
import type { Leg } from "../types";

interface Sample {
  distM: number;
  ele: number;
}

const W = 600;
const H = 120;
const PAD = { top: 8, right: 12, bottom: 22, left: 36 };

export function ElevationProfile() {
  const legs = useRouteStore((s) => s.legs);
  const units = usePreferencesStore((s) => s.units);
  const samples = useMemo(() => sampleLegs(legs), [legs]);

  if (samples.length < 2) {
    return (
      <div className="mt-3 flex h-[120px] items-center justify-center rounded-xl bg-ink-800/40 text-xs text-slate-500 ring-1 ring-white/5">
        Tap on the map to add points and see the elevation profile.
      </div>
    );
  }

  const minEle = Math.min(...samples.map((s) => s.ele));
  const maxEle = Math.max(...samples.map((s) => s.ele));
  const totalDist = samples[samples.length - 1].distM;
  const eleRange = Math.max(maxEle - minEle, 1);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xFor = (d: number) => PAD.left + (d / totalDist) * innerW;
  const yFor = (e: number) => PAD.top + innerH - ((e - minEle) / eleRange) * innerH;

  let path = "";
  let area = `M ${xFor(samples[0].distM)} ${PAD.top + innerH}`;
  samples.forEach((s, i) => {
    const x = xFor(s.distM);
    const y = yFor(s.ele);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    area += ` L ${x} ${y}`;
  });
  area += ` L ${xFor(totalDist)} ${PAD.top + innerH} Z`;

  const ticksY = 3;
  const yTicks: number[] = [];
  for (let i = 0; i <= ticksY; i++) {
    yTicks.push(minEle + (i / ticksY) * eleRange);
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-slate-500">
        <span>Elevation</span>
        <span className="tabular-nums text-slate-400">
          {formatElevation(minEle, units)}–{formatElevation(maxEle, units)}
        </span>
      </div>
      <div className="rounded-xl bg-ink-800/40 p-2 ring-1 ring-white/5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          role="img"
          aria-label="Elevation profile"
        >
          <defs>
            <linearGradient id="rm-elev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="rgba(148,163,184,0.15)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 4}
                y={yFor(t) + 3}
                fontSize={9}
                textAnchor="end"
                fill="#94a3b8"
              >
                {formatElevation(t, units)}
              </text>
            </g>
          ))}
          <path d={area} fill="url(#rm-elev-fill)" />
          <path
            d={path}
            fill="none"
            stroke="#22c55e"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* X axis distance label */}
          <text
            x={W - PAD.right}
            y={H - 6}
            fontSize={9}
            textAnchor="end"
            fill="#94a3b8"
          >
            {formatDistance(totalDist, units)}
          </text>
          <text x={PAD.left} y={H - 6} fontSize={9} fill="#94a3b8">
            {formatDistance(0, units)}
          </text>
        </svg>
      </div>
    </div>
  );
}

function sampleLegs(legs: Leg[]): Sample[] {
  const out: Sample[] = [];
  let cumulative = 0;
  for (const leg of legs) {
    if (leg.coords.length < 2) continue;
    let prev: [number, number] | null = null;
    for (let i = 0; i < leg.coords.length; i++) {
      const c = leg.coords[i];
      if (prev) {
        cumulative += haversine(prev, [c[0], c[1]]);
      }
      const ele = c[2];
      if (ele !== undefined) {
        out.push({ distM: cumulative, ele });
      }
      prev = [c[0], c[1]];
    }
  }
  return out;
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

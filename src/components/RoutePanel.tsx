import { useMemo, useState } from "react";
import { useRouteStore } from "../state/routeStore";
import { ElevationProfile } from "./ElevationProfile";
import { WaypointList } from "./WaypointList";

const formatKm = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;

const formatM = (m: number) => `${Math.round(m)} m`;

export function RoutePanel() {
  const [open, setOpen] = useState(false);
  const name = useRouteStore((s) => s.name);
  const setName = useRouteStore((s) => s.setName);
  const totals = useRouteStore((s) => s.totals());
  const fileName = useRouteStore((s) => s.fileName);
  const dirty = useRouteStore((s) => s.dirty);
  const profile = useRouteStore((s) => s.profile);
  const wpCount = useRouteStore((s) => s.waypoints.length);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${wpCount} pt${wpCount === 1 ? "" : "s"}`);
    parts.push(profile);
    if (fileName) parts.push(fileName);
    return parts.join(" · ");
  }, [wpCount, profile, fileName]);

  return (
    <section
      className="pointer-events-auto absolute bottom-0 left-0 right-0 z-10 mx-auto w-full max-w-2xl rounded-t-3xl bg-ink-900/90 text-slate-100 shadow-sheet ring-1 ring-white/5 backdrop-blur-md"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 4px)" }}
      aria-expanded={open}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col items-stretch px-4 pb-2 pt-0.5 text-left"
        aria-label={open ? "Collapse route panel" : "Expand route panel"}
      >
        <div className="rm-sheet-handle" />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight">
              {name || "Untitled Route"}
              {dirty && (
                <span
                  aria-label="unsaved changes"
                  className="ml-1.5 inline-block translate-y-[-1px] text-amber-400"
                >
                  •
                </span>
              )}
            </div>
            <div className="truncate text-[11px] leading-tight text-slate-400">
              {subtitle}
            </div>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-base font-bold leading-none">
              {formatKm(totals.distanceM)}
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-wider text-slate-400">
              distance
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Distance" value={formatKm(totals.distanceM)} />
            <Stat label="Ascent" value={formatM(totals.ascentM)} />
            <Stat label="Descent" value={formatM(totals.descentM)} />
          </div>

          <div className="mt-3">
            <input
              type="text"
              value={name}
              placeholder="Route name"
              className="w-full rounded-xl bg-ink-800 px-3 py-2 text-sm font-medium ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <ElevationProfile />
          <WaypointList />
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-800/70 p-3 text-left ring-1 ring-white/5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

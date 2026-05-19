import { formatDistance, usePreferencesStore } from "../state/preferences";
import { useRouteStore } from "../state/routeStore";

export function WaypointList() {
  const waypoints = useRouteStore((s) => s.waypoints);
  const selectedIds = useRouteStore((s) => s.selectedIds);
  const setSelected = useRouteStore((s) => s.setSelected);
  const removeWaypoint = useRouteStore((s) => s.removeWaypoint);
  const legs = useRouteStore((s) => s.legs);
  const units = usePreferencesStore((s) => s.units);

  if (waypoints.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 max-h-44 overflow-y-auto rounded-xl bg-ink-800/40 ring-1 ring-white/5 rm-no-scrollbar">
      <ol className="divide-y divide-white/5">
        {waypoints.map((wp, i) => {
          const legBefore = i > 0 ? legs[i - 1] : null;
          const distLabel = legBefore
            ? legBefore.status === "pending"
              ? "…"
              : `+${formatDistance(legBefore.distanceM, units)}`
            : "Start";
          const isSelected = selectedIds.includes(wp.id);
          const kind =
            i === 0
              ? "start"
              : i === waypoints.length - 1 && waypoints.length > 1
                ? "end"
                : "mid";
          return (
            <li
              key={wp.id}
              className={
                "flex items-center gap-3 px-3 py-2 text-sm " +
                (isSelected ? "bg-emerald-500/10" : "")
              }
            >
              <button
                type="button"
                className="flex flex-1 items-center gap-3"
                onClick={() => setSelected(isSelected ? null : wp.id)}
                aria-pressed={isSelected}
              >
                <span
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                    (kind === "start"
                      ? "bg-emerald-500 text-ink-900"
                      : kind === "end"
                        ? "bg-rose-500 text-white"
                        : "bg-white text-ink-900")
                  }
                >
                  {i + 1}
                </span>
                <div className="flex-1 text-left">
                  <div className="text-slate-200">
                    {wp.name ?? `Point ${i + 1}`}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-slate-500">
                    {wp.pos[1].toFixed(5)}, {wp.pos[0].toFixed(5)}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-slate-400">
                  {distLabel}
                </div>
              </button>
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                aria-label={`Remove waypoint ${i + 1}`}
                onClick={() => void removeWaypoint(wp.id)}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  deleteRoute,
  listRoutes,
  loadRoute,
  renameRoute,
  type RouteSummary,
} from "../services/idb";
import {
  formatDistance,
  formatElevation,
  usePreferencesStore,
} from "../state/preferences";
import { useRouteStore } from "../state/routeStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LibraryDrawer({ open, onClose }: Props) {
  const [items, setItems] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const loadIntoStore = useRouteStore((s) => s.loadRoute);
  const dirty = useRouteStore((s) => s.dirty);
  const units = usePreferencesStore((s) => s.units);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listRoutes()
      .then(setItems)
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const refresh = async () => {
    setItems(await listRoutes());
  };

  const onLoad = async (id: string) => {
    if (
      dirty &&
      !window.confirm("You have unsaved changes. Load this route anyway?")
    ) {
      return;
    }
    const r = await loadRoute(id);
    if (r) {
      loadIntoStore(r, { libraryId: id });
      onClose();
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await deleteRoute(id);
    await refresh();
  };

  const startRename = (item: RouteSummary) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };
  const commitRename = async () => {
    if (!editingId) return;
    await renameRoute(editingId, editingName.trim() || "Untitled");
    setEditingId(null);
    await refresh();
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-stretch justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Saved routes"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col bg-ink-900 text-slate-100 shadow-2xl ring-1 ring-white/10"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 12px)",
          paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
        }}
      >
        <header className="flex items-center justify-between px-4 py-3">
          <h2 className="text-lg font-semibold">Library</h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-slate-300 hover:bg-white/10"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-4 rm-no-scrollbar">
          {loading && (
            <div className="py-6 text-center text-sm text-slate-500">
              Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-500">
              <p>No saved routes yet.</p>
              <p className="mt-1 text-xs">
                Tap the save icon in the toolbar to add the current route here.
              </p>
            </div>
          )}
          <ul className="divide-y divide-white/5">
            {items.map((it) => (
              <li key={it.id} className="py-3">
                {editingId === it.id ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 rounded-lg bg-ink-800 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename()}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-ink-900"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => void onLoad(it.id)}
                    >
                      <div className="text-sm font-semibold">{it.name}</div>
                      <div className="text-xs text-slate-400">
                        {it.waypointCount} pt
                        {it.waypointCount === 1 ? "" : "s"} ·{" "}
                        {formatDistance(it.distanceM, units)} ·{" "}
                        {formatElevation(it.ascentM, units)} ↑
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        Saved {timeAgo(it.updatedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(it)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-white/5"
                      aria-label={`Rename ${it.name}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(it.id, it.name)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                      aria-label={`Delete ${it.name}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

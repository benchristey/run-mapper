import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  EditMode,
  Leg,
  LegProfile,
  LngLat,
  PencilMode,
  Route,
  SelectShape,
  Waypoint,
} from "../types";
import { STRAIGHT_PROFILE } from "../types";
import { routeLeg } from "../services/brouter";

const HISTORY_LIMIT = 100;

interface Snapshot {
  waypoints: Waypoint[];
  legs: Leg[];
  profile: LegProfile;
  name: string;
}

interface RouteState {
  id: string;
  name: string;
  waypoints: Waypoint[];
  legs: Leg[];
  profile: LegProfile;
  mode: EditMode;
  /** Multi-selection. `length === 1` is the common single-select case. */
  selectedIds: string[];
  pencilMode: PencilMode;
  selectShape: SelectShape;
  /** Currently-loaded library entry id (if any). */
  libraryId: string | null;
  /** When loaded from a file handle (FS Access API). */
  fileHandle: FileSystemFileHandle | null;
  fileName: string | null;
  /** Filled when "open" was a regular upload. */
  importedAt: number | null;
  history: Snapshot[];
  future: Snapshot[];
  dirty: boolean;

  // ---- Derived ----
  totals: () => { distanceM: number; ascentM: number; descentM: number };

  // ---- Actions ----
  setMode: (m: EditMode) => void;
  setPencilMode: (m: PencilMode) => void;
  setSelectShape: (s: SelectShape) => void;
  /** Replace the selection with a single id (or clear when null). */
  setSelected: (id: string | null) => void;
  /** Add or remove one id from the multi-selection. */
  toggleSelected: (id: string) => void;
  /** Bulk replace the multi-selection. */
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  setName: (n: string) => void;
  setProfile: (p: LegProfile) => Promise<void>;
  setLegProfile: (legIndex: number, profile: LegProfile) => Promise<void>;
  setLegProfiles: (legIndexes: number[], profile: LegProfile) => Promise<void>;
  addWaypoint: (pos: LngLat) => Promise<void>;
  insertWaypointAt: (index: number, pos: LngLat) => Promise<void>;
  moveWaypoint: (id: string, pos: LngLat) => Promise<void>;
  removeWaypoint: (id: string) => Promise<void>;
  /** Bulk delete; reroutes affected legs once at the end. */
  removeWaypoints: (ids: string[]) => Promise<void>;
  reverse: () => Promise<void>;
  closeLoop: () => Promise<void>;
  clearAll: () => void;
  loadRoute: (route: Route, opts?: { libraryId?: string | null; fileHandle?: FileSystemFileHandle | null; fileName?: string | null }) => void;
  toRoute: () => Route;
  markSaved: (opts: { libraryId?: string | null; fileHandle?: FileSystemFileHandle | null; fileName?: string | null }) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const newId = () =>
  (crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

const snap = (s: RouteState): Snapshot => ({
  waypoints: s.waypoints.map((w) => ({ ...w, pos: [...w.pos] as LngLat })),
  legs: s.legs.map((l) => ({ ...l, coords: l.coords.map((c) => [...c] as Leg["coords"][number]) })),
  profile: s.profile,
  name: s.name,
});

const pushHistory = (s: RouteState): Partial<RouteState> => ({
  history: [...s.history.slice(-HISTORY_LIMIT + 1), snap(s)],
  future: [],
  dirty: true,
});

const restore = (snapshot: Snapshot): Partial<RouteState> => ({
  waypoints: snapshot.waypoints.map((w) => ({ ...w, pos: [...w.pos] as LngLat })),
  legs: snapshot.legs.map((l) => ({ ...l })),
  profile: snapshot.profile,
  name: snapshot.name,
});

const straightLeg = (
  from: Waypoint,
  to: Waypoint,
  profile: LegProfile,
  status: "pending" | "straight" = "pending"
): Leg => ({
  fromId: from.id,
  toId: to.id,
  coords: [
    [from.pos[0], from.pos[1]],
    [to.pos[0], to.pos[1]],
  ],
  distanceM: haversine(from.pos, to.pos),
  ascentM: 0,
  descentM: 0,
  profile,
  status,
});

const placeholderLeg = (from: Waypoint, to: Waypoint, profile: LegProfile) =>
  straightLeg(
    from,
    to,
    profile,
    profile === STRAIGHT_PROFILE ? "straight" : "pending"
  );

function haversine(a: LngLat, b: LngLat): number {
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

async function fetchLeg(
  from: Waypoint,
  to: Waypoint,
  profile: LegProfile
): Promise<Leg> {
  if (profile === STRAIGHT_PROFILE) {
    return straightLeg(from, to, profile, "straight");
  }

  try {
    const result = await routeLeg(from.pos, to.pos, profile);
    return {
      fromId: from.id,
      toId: to.id,
      coords: result.coords,
      distanceM: result.distanceM,
      ascentM: result.ascentM,
      descentM: result.descentM,
      profile,
      status: "ok",
    };
  } catch (err) {
    const fallback = straightLeg(from, to, profile, "straight");
    return {
      ...fallback,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

const findLeg = (legs: Leg[], fromId: string, toId: string) =>
  legs.find((l) => l.fromId === fromId && l.toId === toId);

function rebuildLegsPreservingProfiles(
  wps: Waypoint[],
  oldLegs: Leg[],
  defaultProfile: LegProfile
): Leg[] {
  return wps.slice(0, -1).map((from, i) => {
    const to = wps[i + 1];
    const reuse = findLeg(oldLegs, from.id, to.id);
    return reuse ?? placeholderLeg(from, to, defaultProfile);
  });
}

async function refreshLegIndexes(
  get: () => RouteState,
  set: (partial: Partial<RouteState>) => void,
  wps: Waypoint[],
  indexes: number[]
) {
  for (const i of indexes) {
    if (i < 0 || i >= wps.length - 1) continue;
    const current = get().legs[i];
    const profile = current?.profile ?? get().profile;
    const fresh = await fetchLeg(wps[i], wps[i + 1], profile);
    const next = get().legs.slice();
    next[i] = fresh;
    set({ legs: next });
  }
}

export const useRouteStore = create<RouteState>()(
  subscribeWithSelector((set, get) => ({
    id: newId(),
    name: "Untitled Route",
    waypoints: [],
    legs: [],
    profile: "trekking",
    mode: "add",
    selectedIds: [],
    pencilMode: "off",
    selectShape: "rect",
    libraryId: null,
    fileHandle: null,
    fileName: null,
    importedAt: null,
    history: [],
    future: [],
    dirty: false,

    totals: () => {
      const legs = get().legs;
      let distanceM = 0;
      let ascentM = 0;
      let descentM = 0;
      for (const l of legs) {
        distanceM += l.distanceM;
        ascentM += l.ascentM;
        descentM += l.descentM;
      }
      return { distanceM, ascentM, descentM };
    },

    setMode: (m) => set({ mode: m }),
    setPencilMode: (m) =>
      set({
        pencilMode: m,
        // Per UX rule: selection clears whenever Pencil-select mode exits.
        selectedIds: m === "select" ? get().selectedIds : [],
      }),
    setSelectShape: (s) => set({ selectShape: s }),
    setSelected: (id) => set({ selectedIds: id == null ? [] : [id] }),
    toggleSelected: (id) =>
      set((s) =>
        s.selectedIds.includes(id)
          ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
          : { selectedIds: [...s.selectedIds, id] }
      ),
    setSelectedIds: (ids) => set({ selectedIds: ids }),
    clearSelection: () => set({ selectedIds: [] }),
    setName: (n) =>
      set((s) => ({ ...pushHistory(s), name: n })),

    setProfile: async (p) => {
      const before = get();
      if (before.profile === p) return;
      set((s) => ({ ...pushHistory(s), profile: p }));
      // Re-fetch all existing legs with the new profile.
      const wps = get().waypoints;
      const legs: Leg[] = wps.slice(0, -1).map((from, i) =>
        placeholderLeg(from, wps[i + 1], p)
      );
      set({ legs });
      const updated: Leg[] = [];
      for (let i = 0; i < legs.length; i++) {
        updated.push(await fetchLeg(wps[i], wps[i + 1], p));
        // Push a partial update so UI sees progress.
        set({ legs: [...updated, ...legs.slice(updated.length)] });
      }
    },

    setLegProfile: async (legIndex, profile) => {
      const { waypoints, legs } = get();
      if (legIndex < 0 || legIndex >= legs.length) return;
      if (legs[legIndex].profile === profile) return;
      const from = waypoints[legIndex];
      const to = waypoints[legIndex + 1];
      if (!from || !to) return;

      const pending = legs.slice();
      pending[legIndex] = placeholderLeg(from, to, profile);
      set((s) => ({
        ...pushHistory(s),
        legs: pending,
      }));

      const fresh = await fetchLeg(from, to, profile);
      set((s) => {
        const next = s.legs.slice();
        const current = next[legIndex];
        if (current?.fromId === fresh.fromId && current.toId === fresh.toId) {
          next[legIndex] = fresh;
        }
        return { legs: next };
      });
    },

    setLegProfiles: async (legIndexes, profile) => {
      const { waypoints, legs } = get();
      const targets = [...new Set(legIndexes)]
        .filter((i) => i >= 0 && i < legs.length)
        .filter((i) => legs[i].profile !== profile);
      if (targets.length === 0) return;

      const pending = legs.slice();
      for (const i of targets) {
        const from = waypoints[i];
        const to = waypoints[i + 1];
        if (from && to) pending[i] = placeholderLeg(from, to, profile);
      }

      set((s) => ({
        ...pushHistory(s),
        legs: pending,
      }));

      await refreshLegIndexes(get, set, waypoints, targets);
    },

    addWaypoint: async (pos) => {
      const profile = get().profile;
      const wp: Waypoint = { id: newId(), pos };
      const prevWps = get().waypoints;
      set((s) => ({
        ...pushHistory(s),
        waypoints: [...s.waypoints, wp],
        legs:
          prevWps.length === 0
            ? s.legs
            : [...s.legs, placeholderLeg(prevWps[prevWps.length - 1], wp, profile)],
        selectedIds: [wp.id],
      }));
      if (prevWps.length > 0) {
        const newLeg = await fetchLeg(prevWps[prevWps.length - 1], wp, profile);
        set((s) => {
          const legs = [...s.legs];
          // Replace the last leg if it still corresponds to this waypoint pair.
          const last = legs[legs.length - 1];
          if (last && last.fromId === newLeg.fromId && last.toId === newLeg.toId) {
            legs[legs.length - 1] = newLeg;
          }
          return { legs };
        });
      }
    },

    insertWaypointAt: async (index, pos) => {
      const { waypoints, profile } = get();
      const wp: Waypoint = { id: newId(), pos };
      const i = Math.max(0, Math.min(index, waypoints.length));
      const newWps = [...waypoints.slice(0, i), wp, ...waypoints.slice(i)];
      set((s) => ({
        ...pushHistory(s),
        waypoints: newWps,
        selectedIds: [wp.id],
      }));
      // Rebuild affected legs.
      await rerouteAround(get, set, newWps, i, profile, /* movedTo: */ true);
    },

    moveWaypoint: async (id, pos) => {
      const { waypoints, profile } = get();
      const idx = waypoints.findIndex((w) => w.id === id);
      if (idx < 0) return;
      const newWps = waypoints.map((w, i) =>
        i === idx ? { ...w, pos } : w
      );
      set((s) => ({
        ...pushHistory(s),
        waypoints: newWps,
      }));
      await rerouteAround(get, set, newWps, idx, profile, /* movedTo: */ true);
    },

    removeWaypoint: async (id) => {
      const { waypoints, profile } = get();
      const idx = waypoints.findIndex((w) => w.id === id);
      if (idx < 0) return;
      const newWps = waypoints.filter((w) => w.id !== id);
      // Recompute legs before the first state write so the map never sees
      // empty/fewer waypoints paired with stale route geometry.
      const legs = rebuildLegsPreservingProfiles(newWps, get().legs, profile);
      set((s) => ({
        ...pushHistory(s),
        waypoints: newWps,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        legs,
      }));
      if (legs.length === 0) return;
      // Only the leg that crosses the removed index needs refetch (others were unchanged).
      const refreshIndex = idx === 0 || idx >= newWps.length ? -1 : idx - 1;
      await refreshLegIndexes(get, set, newWps, [refreshIndex]);
    },

    removeWaypoints: async (ids) => {
      if (ids.length === 0) return;
      const { waypoints, profile } = get();
      const idSet = new Set(ids);
      const newWps = waypoints.filter((w) => !idSet.has(w.id));
      const oldLegs = get().legs;
      const legs = rebuildLegsPreservingProfiles(newWps, oldLegs, profile);
      set((s) => ({
        ...pushHistory(s),
        waypoints: newWps,
        selectedIds: s.selectedIds.filter((x) => !idSet.has(x)),
        legs,
      }));
      // Rebuild legs once. Pending legs are filled in serially below; this
      // keeps the UX simple and avoids partial inconsistent states.
      if (legs.length === 0) return;
      const changed = legs.flatMap((leg, i) =>
        findLeg(oldLegs, leg.fromId, leg.toId) ? [] : [i]
      );
      await refreshLegIndexes(get, set, newWps, changed);
    },

    reverse: async () => {
      const { waypoints, legs: oldLegs, profile } = get();
      const newWps = [...waypoints].reverse();
      set((s) => ({
        ...pushHistory(s),
        waypoints: newWps,
      }));
      const legs: Leg[] = newWps.slice(0, -1).map((from, i) =>
        placeholderLeg(
          from,
          newWps[i + 1],
          oldLegs[oldLegs.length - 1 - i]?.profile ?? profile
        )
      );
      set({ legs });
      await refreshLegIndexes(get, set, newWps, legs.map((_, i) => i));
    },

    closeLoop: async () => {
      const { waypoints } = get();
      if (waypoints.length < 3) return;
      const first = waypoints[0];
      const last = waypoints[waypoints.length - 1];
      const dist = haversine(first.pos, last.pos);
      if (dist < 5) return; // already closed
      await get().addWaypoint([first.pos[0], first.pos[1]]);
    },

    clearAll: () => {
      const s = get();
      set({
        ...pushHistory(s),
        id: newId(),
        name: "Untitled Route",
        waypoints: [],
        legs: [],
        selectedIds: [],
        libraryId: null,
        fileHandle: null,
        fileName: null,
        importedAt: null,
      });
    },

    loadRoute: (route, opts) => {
      set({
        id: route.id,
        name: route.name,
        waypoints: route.waypoints.map((w) => ({ ...w, pos: [...w.pos] as LngLat })),
        legs: route.legs.map((l) => ({ ...l })),
        profile: route.profile,
        selectedIds: [],
        libraryId: opts?.libraryId ?? null,
        fileHandle: opts?.fileHandle ?? null,
        fileName: opts?.fileName ?? null,
        importedAt: opts?.fileName ? Date.now() : null,
        history: [],
        future: [],
        dirty: false,
      });
    },

    toRoute: () => {
      const s = get();
      return {
        id: s.id,
        name: s.name,
        waypoints: s.waypoints,
        legs: s.legs,
        profile: s.profile,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },

    markSaved: (opts) => {
      set({
        libraryId: opts.libraryId ?? get().libraryId,
        fileHandle: opts.fileHandle ?? get().fileHandle,
        fileName: opts.fileName ?? get().fileName,
        dirty: false,
      });
    },

    undo: async () => {
      const s = get();
      if (s.history.length === 0) return;
      const prev = s.history[s.history.length - 1];
      const current = snap(s);
      set({
        history: s.history.slice(0, -1),
        future: [...s.future, current],
        ...restore(prev),
      });
      // Re-fetch any pending legs (e.g. if undone past a network failure).
      await refreshPendingLegs(get, set);
    },

    redo: async () => {
      const s = get();
      if (s.future.length === 0) return;
      const next = s.future[s.future.length - 1];
      const current = snap(s);
      set({
        history: [...s.history, current],
        future: s.future.slice(0, -1),
        ...restore(next),
      });
      await refreshPendingLegs(get, set);
    },
  }))
);

/**
 * Reroute the legs surrounding a changed waypoint at index `idx`.
 * If movedTo is true, the waypoint at idx itself was inserted/moved (so legs[idx-1] and legs[idx] need updating).
 */
async function rerouteAround(
  get: () => RouteState,
  set: (partial: Partial<RouteState>) => void,
  wps: Waypoint[],
  idx: number,
  defaultProfile: LegProfile,
  _movedTo: boolean
) {
  // Rebuild leg array with placeholders.
  const oldLegs = get().legs;
  const legs: Leg[] = wps.slice(0, -1).map((from, i) => {
    const to = wps[i + 1];
    // Reuse old leg if both endpoints match and not in the affected range.
    if (i !== idx - 1 && i !== idx) {
      const reuse = findLeg(oldLegs, from.id, to.id);
      if (reuse) return reuse;
    }
    const preservedProfile =
      findLeg(oldLegs, from.id, to.id)?.profile ?? defaultProfile;
    return placeholderLeg(from, to, preservedProfile);
  });
  set({ legs });

  const targets: number[] = [];
  if (idx - 1 >= 0 && idx - 1 < legs.length) targets.push(idx - 1);
  if (idx >= 0 && idx < legs.length) targets.push(idx);

  await refreshLegIndexes(get, set, wps, targets);
}

async function refreshPendingLegs(
  get: () => RouteState,
  set: (partial: Partial<RouteState>) => void
) {
  const { waypoints, legs } = get();
  const next = [...legs];
  for (let i = 0; i < next.length; i++) {
    if (next[i].status === "pending") {
      next[i] = await fetchLeg(waypoints[i], waypoints[i + 1], next[i].profile);
      set({ legs: [...next] });
    }
  }
}

export type LngLat = [number, number];

export type LngLatEle = [number, number, number?];

export interface Waypoint {
  id: string;
  pos: LngLat;
  name?: string;
}

export type LegStatus = "pending" | "ok" | "error" | "straight";

export interface Leg {
  fromId: string;
  toId: string;
  /** Routed polyline, including elevation when available. */
  coords: LngLatEle[];
  distanceM: number;
  ascentM: number;
  descentM: number;
  profile: string;
  status: LegStatus;
  errorMessage?: string;
}

export interface Route {
  id: string;
  name: string;
  waypoints: Waypoint[];
  /** legs[i] connects waypoints[i] -> waypoints[i+1]. length === waypoints.length - 1 (or 0). */
  legs: Leg[];
  profile: BrouterProfile;
  createdAt: number;
  updatedAt: number;
}

export const BROUTER_PROFILES = [
  "trekking",
  "fastbike",
  "hiking-mountain",
  "shortest",
] as const;
export type BrouterProfile = (typeof BROUTER_PROFILES)[number];

export const PROFILE_LABELS: Record<BrouterProfile, string> = {
  trekking: "Trekking (default)",
  fastbike: "Fast / road",
  "hiking-mountain": "Hiking / trail",
  shortest: "Shortest path",
};

export type EditMode = "pan" | "add";

/**
 * Pencil-only mode that overrides finger behaviour when active. When `off`,
 * the regular `EditMode` (Pin toggle) governs both finger and pencil. When
 * `add` or `select`, finger always pans/zooms — Pencil is the only input that
 * places waypoints (or draws a selection). See `.cursor/rules/ipad-ux.mdc`.
 */
export type PencilMode = "off" | "add" | "select";

/** Shape used when `pencilMode === "select"`. */
export type SelectShape = "rect" | "lasso";

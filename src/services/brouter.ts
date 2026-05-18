import type { BrouterProfile, LngLat, LngLatEle } from "../types";

const BROUTER_BASE = "https://brouter.de/brouter";

export interface RoutedLeg {
  coords: LngLatEle[];
  distanceM: number;
  ascentM: number;
  descentM: number;
}

const memoryCache = new Map<string, RoutedLeg>();

const cacheKey = (a: LngLat, b: LngLat, profile: string) => {
  // Round to ~1m precision so trivial sub-meter drag wobble still hits cache.
  const r = (n: number) => n.toFixed(5);
  return `${profile}|${r(a[0])},${r(a[1])}|${r(b[0])},${r(b[1])}`;
};

interface BrouterFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: Record<string, string | number>;
}
interface BrouterFeatureCollection {
  type: "FeatureCollection";
  features: BrouterFeature[];
}

/**
 * Routes a single leg using the BRouter public API.
 * Throws on network or HTTP error.
 */
export async function routeLeg(
  from: LngLat,
  to: LngLat,
  profile: BrouterProfile,
  signal?: AbortSignal
): Promise<RoutedLeg> {
  const key = cacheKey(from, to, profile);
  const cached = memoryCache.get(key);
  if (cached) return cached;

  const lonlats = `${from[0].toFixed(6)},${from[1].toFixed(6)}|${to[0].toFixed(6)},${to[1].toFixed(6)}`;
  const url =
    `${BROUTER_BASE}?lonlats=${encodeURIComponent(lonlats)}` +
    `&profile=${encodeURIComponent(profile)}` +
    `&alternativeidx=0&format=geojson`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`BRouter ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as BrouterFeatureCollection;
  const feature = data.features?.[0];
  if (!feature || feature.geometry?.type !== "LineString") {
    throw new Error("BRouter returned no route");
  }

  const coords: LngLatEle[] = feature.geometry.coordinates.map((c) => {
    const [lng, lat, ele] = c;
    return ele !== undefined
      ? ([lng, lat, ele] as LngLatEle)
      : ([lng, lat] as LngLatEle);
  });

  const props = feature.properties || {};
  const distanceM = num(props["track-length"]) ?? lineLength(coords);
  // BRouter returns "filtered ascend" (most realistic) and "plain-ascend".
  const ascentM = num(props["filtered ascend"]) ?? num(props["plain-ascend"]) ?? 0;
  const descentM = computeDescent(coords);

  const result: RoutedLeg = { coords, distanceM, ascentM, descentM };
  memoryCache.set(key, result);
  return result;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function computeDescent(coords: LngLatEle[]): number {
  let descent = 0;
  for (let i = 1; i < coords.length; i++) {
    const aE = coords[i - 1][2];
    const bE = coords[i][2];
    if (aE !== undefined && bE !== undefined) {
      const d = aE - bE;
      if (d > 0) descent += d;
    }
  }
  return descent;
}

function lineLength(coords: LngLatEle[]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    m += haversine(
      [coords[i - 1][0], coords[i - 1][1]],
      [coords[i][0], coords[i][1]]
    );
  }
  return m;
}

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

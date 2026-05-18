import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type {
  BrouterProfile,
  Leg,
  LngLat,
  LngLatEle,
  Route,
  Waypoint,
} from "../types";
import { BROUTER_PROFILES } from "../types";

const RM_NS = "https://runmapper.app/schema/1";
const GENERIC_GPX_MAX_WAYPOINTS = 500;
const GENERIC_GPX_MIN_WAYPOINT_SPACING_M = 20;
const GENERIC_GPX_INITIAL_TOLERANCE_M = 8;
const GENERIC_GPX_MAX_TOLERANCE_M = 250;

const newId = () =>
  (crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

interface RmExt {
  profile?: string;
  waypoints?: { wp: { "@_id": string; "@_index": number; "@_lat": number; "@_lon": number; "@_name"?: string }[] };
  legs?: { leg: { "@_fromId": string; "@_toId": string; "@_status": string; "@_distanceM": number; "@_ascentM": number; "@_descentM": number }[] };
}

interface GpxRouteJson {
  gpx?: {
    "@_creator"?: string;
    "@_version"?: string;
    metadata?: {
      name?: string;
      time?: string;
      extensions?: { "rm:runmapper"?: RmExt };
    };
    wpt?: GpxWpt[] | GpxWpt;
    trk?: GpxTrk[] | GpxTrk;
  };
}
interface GpxWpt {
  "@_lat": number | string;
  "@_lon": number | string;
  ele?: number | string;
  name?: string;
  cmt?: string;
  desc?: string;
}
interface GpxTrk {
  name?: string;
  trkseg?: GpxTrkseg[] | GpxTrkseg;
}
interface GpxTrkseg {
  trkpt?: GpxWpt[] | GpxWpt;
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "  ",
  suppressEmptyNode: false,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
});

function arr<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Serialize a Route to a GPX 1.1 XML string.
 * The track holds the routed coords; waypoints hold the planned points;
 * a runmapper:* extensions block lets us round-trip exactly.
 */
export function serializeGpx(route: Route): string {
  const trkpts: { ele?: number; "@_lat": number; "@_lon": number }[] = [];
  for (const leg of route.legs) {
    for (const c of leg.coords) {
      const pt: { ele?: number; "@_lat": number; "@_lon": number } = {
        "@_lat": c[1],
        "@_lon": c[0],
      };
      if (c[2] !== undefined) pt.ele = c[2];
      trkpts.push(pt);
    }
  }
  if (route.legs.length === 0 && route.waypoints.length > 0) {
    // No routed legs (e.g. single point, or all legs failed) — fall back to plain waypoint line.
    for (const wp of route.waypoints) {
      trkpts.push({ "@_lat": wp.pos[1], "@_lon": wp.pos[0] });
    }
  }

  const wpts = route.waypoints.map((wp, i) => ({
    "@_lat": wp.pos[1],
    "@_lon": wp.pos[0],
    name: wp.name ?? `Point ${i + 1}`,
  }));

  const rmExt: RmExt = {
    profile: route.profile,
    waypoints: {
      wp: route.waypoints.map((wp, i) => ({
        "@_id": wp.id,
        "@_index": i,
        "@_lat": wp.pos[1],
        "@_lon": wp.pos[0],
        ...(wp.name ? { "@_name": wp.name } : {}),
      })),
    },
    legs: {
      leg: route.legs.map((l) => ({
        "@_fromId": l.fromId,
        "@_toId": l.toId,
        "@_status": l.status,
        "@_distanceM": Math.round(l.distanceM),
        "@_ascentM": Math.round(l.ascentM),
        "@_descentM": Math.round(l.descentM),
      })),
    },
  };

  const xml = builder.build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    gpx: {
      "@_xmlns": "http://www.topografix.com/GPX/1/1",
      "@_xmlns:rm": RM_NS,
      "@_creator": "RunMapper",
      "@_version": "1.1",
      metadata: {
        name: route.name,
        time: new Date(route.updatedAt || Date.now()).toISOString(),
        extensions: { "rm:runmapper": rmExt },
      },
      wpt: wpts,
      trk: {
        name: route.name,
        trkseg: { trkpt: trkpts },
      },
    },
  });

  return typeof xml === "string" ? xml : String(xml);
}

/**
 * Parse a GPX file into a Route. Recognizes RunMapper-authored extensions for full round-tripping;
 * falls back to a track-only Route otherwise (the user can re-add waypoints to start editing).
 */
export function parseGpx(xmlText: string, fileName?: string): Route {
  const json = parser.parse(xmlText) as GpxRouteJson;
  const gpx = json.gpx;
  if (!gpx) throw new Error("Not a GPX file (missing <gpx> root)");

  const metaName = gpx.metadata?.name ?? gpxTrkName(gpx);
  const baseName = metaName || stripExt(fileName ?? "Imported route");

  const rmExt = gpx.metadata?.extensions?.["rm:runmapper"];
  if (rmExt && rmExt.waypoints) {
    return hydrateFromRm(gpx, rmExt, baseName);
  }
  return hydrateGenericGpx(gpx, baseName);
}

function gpxTrkName(gpx: NonNullable<GpxRouteJson["gpx"]>): string | undefined {
  const trk = arr(gpx.trk)[0];
  return trk?.name;
}

function hydrateFromRm(
  gpx: NonNullable<GpxRouteJson["gpx"]>,
  rm: RmExt,
  name: string
): Route {
  const profile = (
    BROUTER_PROFILES.includes(rm.profile as BrouterProfile)
      ? rm.profile
      : "trekking"
  ) as BrouterProfile;
  const wpEntries = arr(rm.waypoints?.wp).slice().sort((a, b) => a["@_index"] - b["@_index"]);
  const waypoints: Waypoint[] = wpEntries.map((w) => ({
    id: w["@_id"] || newId(),
    pos: [Number(w["@_lon"]), Number(w["@_lat"])] as LngLat,
    name: w["@_name"],
  }));

  // Reconstruct legs by walking the track and chunking on waypoint coordinates.
  const trk = arr(gpx.trk)[0];
  const allTrkpts: GpxWpt[] = [];
  for (const seg of arr(trk?.trkseg)) {
    for (const pt of arr(seg.trkpt)) allTrkpts.push(pt);
  }

  const trkLngLats: LngLatEle[] = allTrkpts.map((p) => {
    const e = p.ele !== undefined ? Number(p.ele) : undefined;
    return e !== undefined
      ? ([Number(p["@_lon"]), Number(p["@_lat"]), e] as LngLatEle)
      : ([Number(p["@_lon"]), Number(p["@_lat"])] as LngLatEle);
  });

  const legMeta = arr(rm.legs?.leg);
  const legs: Leg[] = [];

  // Find indices in trk where each waypoint sits, then slice between them.
  const wpIndices = waypoints.map((wp) => closestIndex(trkLngLats, wp.pos));
  for (let i = 0; i < waypoints.length - 1; i++) {
    const start = wpIndices[i];
    const end = wpIndices[i + 1];
    let coords: LngLatEle[];
    if (end > start) {
      coords = trkLngLats.slice(start, end + 1);
    } else if (end === start) {
      coords = [trkLngLats[start], trkLngLats[start]];
    } else {
      coords = [
        [waypoints[i].pos[0], waypoints[i].pos[1]],
        [waypoints[i + 1].pos[0], waypoints[i + 1].pos[1]],
      ];
    }
    const meta = legMeta[i];
    legs.push({
      fromId: waypoints[i].id,
      toId: waypoints[i + 1].id,
      coords,
      distanceM: meta ? Number(meta["@_distanceM"]) : lineLength(coords),
      ascentM: meta ? Number(meta["@_ascentM"]) : 0,
      descentM: meta ? Number(meta["@_descentM"]) : 0,
      profile,
      status: ((meta?.["@_status"] as Leg["status"]) ?? "ok"),
    });
  }

  return {
    id: newId(),
    name,
    waypoints,
    legs,
    profile,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function hydrateGenericGpx(
  gpx: NonNullable<GpxRouteJson["gpx"]>,
  name: string
): Route {
  // Prefer trackpoints: keep the original track geometry, but simplify the
  // editable waypoint controls so large activity exports remain usable.
  const wpts: GpxWpt[] = arr(gpx.wpt);

  const trk = arr(gpx.trk)[0];
  const trkpts: GpxWpt[] = [];
  for (const seg of arr(trk?.trkseg)) {
    for (const p of arr(seg.trkpt)) trkpts.push(p);
  }
  const trkLngLats = dedupeConsecutive(
    trkpts.map((p) => {
      const e = p.ele !== undefined ? Number(p.ele) : undefined;
      return e !== undefined
        ? ([Number(p["@_lon"]), Number(p["@_lat"]), e] as LngLatEle)
        : ([Number(p["@_lon"]), Number(p["@_lat"])] as LngLatEle);
    })
  );

  const controlIndexes =
    trkLngLats.length > 0 ? simplifyTrackpointIndexes(trkLngLats) : [];

  const waypoints: Waypoint[] =
    controlIndexes.length > 0
      ? controlIndexes.map((trackIndex, i) => {
          const p = trkLngLats[trackIndex];
          return {
          id: newId(),
          pos: [p[0], p[1]] as LngLat,
          name: `Point ${i + 1}`,
          };
        })
      : wpts.map((w, i) => ({
          id: newId(),
          pos: [Number(w["@_lon"]), Number(w["@_lat"])] as LngLat,
          name: w.name ?? `Point ${i + 1}`,
        }));

  const legs: Leg[] =
    controlIndexes.length >= 2
      ? controlIndexes.slice(0, -1).map((start, i) => {
          const end = controlIndexes[i + 1];
          const coords = trkLngLats.slice(start, end + 1);
          return {
            fromId: waypoints[i].id,
            toId: waypoints[i + 1].id,
            coords,
            distanceM: lineLength(coords),
            ascentM: computeAscent(coords),
            descentM: computeDescent(coords),
            profile: "trekking",
            status: "ok",
          };
        })
      : [];

  return {
    id: newId(),
    name,
    waypoints,
    legs,
    profile: "trekking",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function dedupeConsecutive(coords: LngLatEle[]): LngLatEle[] {
  const result: LngLatEle[] = [];
  for (const coord of coords) {
    const prev = result[result.length - 1];
    if (prev && prev[0] === coord[0] && prev[1] === coord[1]) continue;
    result.push(coord);
  }
  return result;
}

function simplifyTrackpointIndexes(coords: LngLatEle[]): number[] {
  if (coords.length <= 2) return coords.map((_, i) => i);

  const spacedIndexes = minimumSpacedIndexes(
    coords,
    GENERIC_GPX_MIN_WAYPOINT_SPACING_M
  );
  const spacedCoords = spacedIndexes.map((i) => coords[i]);
  let tolerance = GENERIC_GPX_INITIAL_TOLERANCE_M;
  let simplified = douglasPeuckerIndexes(spacedCoords, tolerance);

  while (
    simplified.length > GENERIC_GPX_MAX_WAYPOINTS &&
    tolerance < GENERIC_GPX_MAX_TOLERANCE_M
  ) {
    tolerance = Math.min(tolerance * 1.6, GENERIC_GPX_MAX_TOLERANCE_M);
    simplified = douglasPeuckerIndexes(spacedCoords, tolerance);
  }

  const trackIndexes = simplified.map((i) => spacedIndexes[i]);
  return capIndexes(trackIndexes, GENERIC_GPX_MAX_WAYPOINTS);
}

function minimumSpacedIndexes(coords: LngLatEle[], minDistanceM: number): number[] {
  const indexes = [0];
  let last = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    if (haversine(toLngLat(coords[last]), toLngLat(coords[i])) >= minDistanceM) {
      indexes.push(i);
      last = i;
    }
  }
  if (coords.length > 1) indexes.push(coords.length - 1);
  return indexes;
}

function douglasPeuckerIndexes(coords: LngLatEle[], toleranceM: number): number[] {
  if (coords.length <= 2) return coords.map((_, i) => i);

  const keep = new Array<boolean>(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;
  const originLat = coords[0][1];
  const points = coords.map((coord) => projectMeters(coord, originLat));
  const stack: Array<[number, number]> = [[0, coords.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let bestIndex = -1;
    let bestDistance = 0;
    for (let i = start + 1; i < end; i++) {
      const distance = pointSegmentDistanceM(points[i], points[start], points[end]);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestDistance > toleranceM) {
      keep[bestIndex] = true;
      stack.push([start, bestIndex], [bestIndex, end]);
    }
  }

  return keep.flatMap((shouldKeep, i) => (shouldKeep ? [i] : []));
}

function capIndexes(indexes: number[], maxCount: number): number[] {
  if (indexes.length <= maxCount) return indexes;
  const capped: number[] = [];
  for (let i = 0; i < maxCount; i++) {
    const sourceIndex = Math.round((i * (indexes.length - 1)) / (maxCount - 1));
    const value = indexes[sourceIndex];
    if (capped[capped.length - 1] !== value) capped.push(value);
  }
  return capped;
}

function toLngLat(coord: LngLatEle): LngLat {
  return [coord[0], coord[1]];
}

function projectMeters(coord: LngLatEle, originLat: number): [number, number] {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLng =
    111_320 * Math.cos((originLat * Math.PI) / 180);
  return [coord[0] * metersPerDegreeLng, coord[1] * metersPerDegreeLat];
}

function pointSegmentDistanceM(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy))
  );
  const x = start[0] + t * dx;
  const y = start[1] + t * dy;
  return Math.hypot(point[0] - x, point[1] - y);
}

function closestIndex(coords: LngLatEle[], pos: LngLat): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dx = coords[i][0] - pos[0];
    const dy = coords[i][1] - pos[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
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

function computeAscent(coords: LngLatEle[]): number {
  let asc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1][2];
    const b = coords[i][2];
    if (a !== undefined && b !== undefined && b > a) asc += b - a;
  }
  return asc;
}

function computeDescent(coords: LngLatEle[]): number {
  let desc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1][2];
    const b = coords[i][2];
    if (a !== undefined && b !== undefined && a > b) desc += a - b;
  }
  return desc;
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

function stripExt(s: string): string {
  return s.replace(/\.[^.]+$/, "");
}

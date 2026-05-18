import { openDB, type IDBPDatabase } from "idb";
import type { Route } from "../types";

const DB_NAME = "runmapper";
const DB_VERSION = 1;
const STORE = "routes";

export interface RouteSummary {
  id: string;
  name: string;
  waypointCount: number;
  distanceM: number;
  ascentM: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("byUpdated", "updatedAt");
        }
      },
    });
  }
  return dbPromise;
}

export async function listRoutes(): Promise<RouteSummary[]> {
  const all = await (await db()).getAllFromIndex(STORE, "byUpdated");
  return (all as Route[])
    .map((r) => ({
      id: r.id,
      name: r.name,
      waypointCount: r.waypoints.length,
      distanceM: r.legs.reduce((acc, l) => acc + l.distanceM, 0),
      ascentM: r.legs.reduce((acc, l) => acc + l.ascentM, 0),
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadRoute(id: string): Promise<Route | undefined> {
  return (await (await db()).get(STORE, id)) as Route | undefined;
}

export async function saveRoute(route: Route): Promise<Route> {
  const stored = { ...route, updatedAt: Date.now() };
  await (await db()).put(STORE, stored);
  return stored;
}

export async function renameRoute(id: string, name: string): Promise<void> {
  const tx = (await db()).transaction(STORE, "readwrite");
  const route = (await tx.store.get(id)) as Route | undefined;
  if (route) {
    route.name = name;
    route.updatedAt = Date.now();
    await tx.store.put(route);
  }
  await tx.done;
}

export async function deleteRoute(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

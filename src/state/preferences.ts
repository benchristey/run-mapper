import { create } from "zustand";

export type Units = "metric" | "imperial";

const UNITS_KEY = "runmapper:units";
const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

function readInitialUnits(): Units {
  try {
    const value = window.localStorage.getItem(UNITS_KEY);
    return value === "imperial" || value === "metric" ? value : "metric";
  } catch {
    return "metric";
  }
}

export const usePreferencesStore = create<{
  units: Units;
  setUnits: (units: Units) => void;
  toggleUnits: () => void;
}>((set, get) => ({
  units: readInitialUnits(),
  setUnits: (units) => {
    try {
      window.localStorage.setItem(UNITS_KEY, units);
    } catch {
      // Ignore storage failures; the in-memory preference still updates.
    }
    set({ units });
  },
  toggleUnits: () => {
    get().setUnits(get().units === "metric" ? "imperial" : "metric");
  },
}));

export function formatDistance(meters: number, units: Units): string {
  if (units === "imperial") {
    const miles = meters / METERS_PER_MILE;
    if (miles >= 0.1) return `${miles.toFixed(2)} mi`;
    return `${Math.round(meters * FEET_PER_METER)} ft`;
  }

  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatElevation(meters: number, units: Units): string {
  if (units === "imperial") {
    return `${Math.round(meters * FEET_PER_METER)} ft`;
  }
  return `${Math.round(meters)} m`;
}

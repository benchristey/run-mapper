import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type MapMouseEvent,
  type MapTouchEvent,
  Map as MLMap,
  Marker,
  NavigationControl,
  GeolocateControl,
  ScaleControl,
} from "maplibre-gl";
import { useRouteStore } from "../state/routeStore";
import type { Leg, LngLat, PencilMode, SelectShape, Waypoint } from "../types";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const ROUTE_SOURCE = "rm-route";
const ROUTE_LAYER = "rm-route-line";
const ROUTE_LAYER_PENDING = "rm-route-pending";
const ROUTE_CASING_LAYER = "rm-route-casing";

const initialView = {
  // Default near London — most users will geolocate immediately anyway.
  center: [-0.1, 51.5] as [number, number],
  zoom: 12,
};

interface PenDraw {
  type: SelectShape;
  /** Start point in canvas-local pixels. */
  startPx: [number, number];
  /** Current/latest point in canvas-local pixels. */
  currentPx: [number, number];
  /** Sampled path for lasso (start..current). Only populated for `lasso`. */
  pathPx: [number, number][];
}

interface MapViewProps {
  onToast?: (message: string) => void;
}

export function MapView({ onToast }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const lastFitRouteIdRef = useRef<string | null>(null);
  const startupLocationAttemptedRef = useRef(false);
  const mapReadyRef = useRef(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [penDraw, setPenDraw] = useState<PenDraw | null>(null);
  /** Latest waypoints/legs are mirrored to refs so map handlers don't need to re-bind on every change. */
  const stateRef = useRef({
    waypoints: [] as Waypoint[],
    legs: [] as Leg[],
    selectedIds: [] as string[],
    mode: "add" as "pan" | "add",
    pencilMode: "off" as PencilMode,
    selectShape: "rect" as SelectShape,
  });

  // ---- Initialize map ----
  useEffect(() => {
    if (!containerRef.current) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: containerRef.current,
        style: MAP_STYLE,
        center: initialView.center,
        zoom: initialView.zoom,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
        touchPitch: false,
        hash: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("MapLibre init failed:", err);
      setInitError(msg);
      return;
    }
    mapRef.current = map;

    map.touchZoomRotate.disableRotation();

    map.on("error", (ev) => {
      // Surface map errors for easier debugging during development.
      console.warn("MapLibre error:", ev.error ?? ev);
      const msg = ev.error?.message ?? String(ev);
      if (
        isRecoverableMapResourceError(msg) &&
        (mapReadyRef.current || map.isStyleLoaded())
      ) {
        return;
      }
      // Only show the FIRST style/network error in the UI; subsequent tile errors are noise.
      setInitError((prev) => prev ?? msg);
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-right"
    );
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.once("load", () => {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: emptyFC(),
      });
      map.addLayer({
        id: ROUTE_CASING_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#000000",
          "line-opacity": 0.25,
          "line-width": 8,
        },
        filter: ["!=", ["get", "status"], "pending"],
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "status"],
            "ok",
            "#22c55e",
            "straight",
            "#f59e0b",
            "error",
            "#ef4444",
            "#22c55e",
          ],
          "line-width": 5,
        },
        filter: ["!=", ["get", "status"], "pending"],
      });
      map.addLayer({
        id: ROUTE_LAYER_PENDING,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#94a3b8",
          "line-width": 4,
          "line-dasharray": [2, 2],
          "line-opacity": 0.85,
        },
        filter: ["==", ["get", "status"], "pending"],
      });

      // After style is ready, sync once and let the subscription handle further updates.
      mapReadyRef.current = true;
      setInitError((prev) =>
        prev && isRecoverableMapResourceError(prev) ? null : prev
      );
      syncRouteSource(map);
      syncMarkers(map);
      tryCenterOnStartupLocation(map);
    });

    // ---- Pointer interactions ----
    const handleClick = (e: MapMouseEvent) => {
      // Finger never adds while a Pencil mode is engaged — Pencil is the
      // only input that can place/select waypoints in those modes.
      if (stateRef.current.pencilMode !== "off") return;
      const { mode } = stateRef.current;
      if (mode !== "add") return;
      const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
      void useRouteStore.getState().addWaypoint(lngLat);
    };
    map.on("click", handleClick);

    // Long-press in pan mode adds a waypoint (power-user shortcut).
    let longPressTimer: number | null = null;
    let longPressStart: [number, number] | null = null;
    let longPressFired = false;
    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressStart = null;
    };
    const onTouchStart = (e: MapTouchEvent) => {
      if (stateRef.current.pencilMode !== "off") return;
      if (e.originalEvent.touches.length !== 1) {
        cancelLongPress();
        return;
      }
      longPressFired = false;
      longPressStart = [e.point.x, e.point.y];
      const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
      longPressTimer = window.setTimeout(() => {
        const { mode } = stateRef.current;
        if (mode === "pan") {
          longPressFired = true;
          if (navigator.vibrate) navigator.vibrate(15);
          void useRouteStore.getState().addWaypoint(lngLat);
        }
      }, 600);
    };
    const onTouchMove = (e: MapTouchEvent) => {
      if (!longPressStart) return;
      const dx = e.point.x - longPressStart[0];
      const dy = e.point.y - longPressStart[1];
      if (Math.hypot(dx, dy) > 10) cancelLongPress();
    };
    const onTouchEnd = (e: MapTouchEvent) => {
      if (longPressFired) e.originalEvent.preventDefault();
      cancelLongPress();
    };
    map.on("touchstart", onTouchStart);
    map.on("touchmove", onTouchMove);
    map.on("touchend", onTouchEnd);
    map.on("touchcancel", cancelLongPress);

    // Tap on a route line in add-mode = insert waypoint at that position into nearest leg.
    map.on("click", ROUTE_LAYER, (e) => {
      if (stateRef.current.pencilMode !== "off") return;
      const { mode } = stateRef.current;
      if (mode !== "add") return;
      e.preventDefault?.();
      const f = e.features?.[0];
      if (!f) return;
      const legIdx = (f.properties?.legIndex as number) ?? -1;
      if (legIdx < 0) return;
      const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
      // Insert AFTER waypoints[legIdx], i.e. at index legIdx+1.
      void useRouteStore.getState().insertWaypointAt(legIdx + 1, lngLat);
    });
    map.on("mouseenter", ROUTE_LAYER, () => {
      map.getCanvas().style.cursor = "copy";
    });
    map.on("mouseleave", ROUTE_LAYER, () => {
      map.getCanvas().style.cursor = "";
    });

    // ---- Apple Pencil: pointer events on the canvas ----
    // We listen at the canvas level (rather than map.on(...)) because:
    //  1) MapMouseEvent doesn't expose pointerType, so we can't tell pen apart.
    //  2) preventDefault on `pointerdown` for `pen` suppresses the synthesized
    //     touch events MapLibre uses for pan/pinch — letting us draw freely.
    const canvas = map.getCanvas();
    let penDownPx: [number, number] | null = null;
    let penMoved = false;
    let penDrawing: PenDraw | null = null;
    let lastSamplePx: [number, number] | null = null;
    let restoreDragPanAfterPen: boolean | null = null;
    let suppressMouseUntil = 0;
    const TAP_THRESHOLD_PX = 6;
    const LASSO_SAMPLE_PX = 4;
    const penListenerOptions: AddEventListenerOptions = {
      passive: false,
      capture: true,
    };

    const canvasRel = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };

    const claimPenEvent = (e: PointerEvent) => {
      suppressMouseUntil = performance.now() + 700;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const suspendMapDragForPen = () => {
      if (restoreDragPanAfterPen !== null) return;
      restoreDragPanAfterPen = map.dragPan.isEnabled();
      if (restoreDragPanAfterPen) map.dragPan.disable();
    };

    const restoreMapDragAfterPen = () => {
      if (restoreDragPanAfterPen === null) return;
      if (restoreDragPanAfterPen) map.dragPan.enable();
      restoreDragPanAfterPen = null;
    };

    const onPenDown = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      const { pencilMode } = stateRef.current;
      if (pencilMode === "off") return;
      claimPenEvent(e);
      suspendMapDragForPen();
      const px = canvasRel(e);
      penDownPx = px;
      penMoved = false;
      lastSamplePx = px;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture is best-effort
      }
      if (pencilMode === "select") {
        const { selectShape } = stateRef.current;
        penDrawing = {
          type: selectShape,
          startPx: px,
          currentPx: px,
          pathPx: selectShape === "lasso" ? [px] : [],
        };
        setPenDraw(penDrawing);
      }
    };

    const onPenMove = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      if (!penDownPx) return;
      claimPenEvent(e);
      const px = canvasRel(e);
      const dx = px[0] - penDownPx[0];
      const dy = px[1] - penDownPx[1];
      if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) penMoved = true;
      if (penDrawing) {
        penDrawing.currentPx = px;
        if (penDrawing.type === "lasso" && lastSamplePx) {
          const sdx = px[0] - lastSamplePx[0];
          const sdy = px[1] - lastSamplePx[1];
          if (Math.hypot(sdx, sdy) >= LASSO_SAMPLE_PX) {
            penDrawing.pathPx.push(px);
            lastSamplePx = px;
          }
        }
        setPenDraw({ ...penDrawing });
      }
    };

    const onPenUp = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      if (!penDownPx) return;
      claimPenEvent(e);
      const px = canvasRel(e);
      const { pencilMode } = stateRef.current;
      if (pencilMode === "add" && !penMoved) {
        // Tap → add a waypoint (or insert into a route line if hit).
        const lngLat = map.unproject(px);
        const features = map.queryRenderedFeatures(px, { layers: [ROUTE_LAYER] });
        if (features.length > 0) {
          const legIdx = (features[0].properties?.legIndex as number) ?? -1;
          if (legIdx >= 0) {
            void useRouteStore
              .getState()
              .insertWaypointAt(legIdx + 1, [lngLat.lng, lngLat.lat]);
          } else {
            void useRouteStore.getState().addWaypoint([lngLat.lng, lngLat.lat]);
          }
        } else {
          void useRouteStore.getState().addWaypoint([lngLat.lng, lngLat.lat]);
        }
      } else if (pencilMode === "select") {
        if (penDrawing && penMoved) {
          const ids = hitTestSelection(map, stateRef.current.waypoints, penDrawing);
          useRouteStore.getState().setSelectedIds(ids);
        } else if (!penMoved) {
          // Pen tap: hit-test the marker layer. If on a waypoint, toggle.
          // If on empty map, clear the selection.
          const wpId = pickWaypointAtPx(map, stateRef.current.waypoints, px);
          if (wpId) {
            useRouteStore.getState().toggleSelected(wpId);
          } else {
            useRouteStore.getState().clearSelection();
          }
        }
      }
      penDownPx = null;
      penDrawing = null;
      penMoved = false;
      lastSamplePx = null;
      setPenDraw(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      restoreMapDragAfterPen();
    };

    const onPenCancel = (e: PointerEvent) => {
      if (e.pointerType !== "pen") return;
      if (penDownPx) claimPenEvent(e);
      penDownPx = null;
      penDrawing = null;
      penMoved = false;
      lastSamplePx = null;
      setPenDraw(null);
      restoreMapDragAfterPen();
    };

    const onCompatMouse = (e: MouseEvent) => {
      if (performance.now() > suppressMouseUntil) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    canvas.addEventListener("pointerdown", onPenDown, penListenerOptions);
    canvas.addEventListener("pointermove", onPenMove, penListenerOptions);
    canvas.addEventListener("pointerup", onPenUp, penListenerOptions);
    canvas.addEventListener("pointercancel", onPenCancel, penListenerOptions);
    canvas.addEventListener("mousedown", onCompatMouse, true);
    canvas.addEventListener("mouseup", onCompatMouse, true);
    canvas.addEventListener("click", onCompatMouse, true);

    return () => {
      cancelLongPress();
      restoreMapDragAfterPen();
      canvas.removeEventListener("pointerdown", onPenDown, penListenerOptions);
      canvas.removeEventListener("pointermove", onPenMove, penListenerOptions);
      canvas.removeEventListener("pointerup", onPenUp, penListenerOptions);
      canvas.removeEventListener("pointercancel", onPenCancel, penListenerOptions);
      canvas.removeEventListener("mousedown", onCompatMouse, true);
      canvas.removeEventListener("mouseup", onCompatMouse, true);
      canvas.removeEventListener("click", onCompatMouse, true);
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      markersRef.current.clear();
    };
  }, []);

  // ---- Subscribe to store changes ----
  useEffect(() => {
    const unsubRoute = useRouteStore.subscribe(
      (s) => [s.id, s.waypoints, s.legs] as const,
      ([routeId, waypoints, legs]) => {
        stateRef.current.waypoints = waypoints;
        stateRef.current.legs = legs;
        const map = mapRef.current;
        if (!map) return;
        if (map.isStyleLoaded()) {
          syncRouteSource(map);
          syncMarkers(map);
          fitLoadedRoute(map, routeId);
        } else {
          map.once("load", () => {
            syncRouteSource(map);
            syncMarkers(map);
            fitLoadedRoute(map, routeId);
          });
        }
      },
      {
        equalityFn: ([a1, a2, a3], [b1, b2, b3]) =>
          a1 === b1 && a2 === b2 && a3 === b3,
        fireImmediately: true,
      }
    );

    const unsubSelected = useRouteStore.subscribe(
      (s) => s.selectedIds,
      (ids) => {
        stateRef.current.selectedIds = ids;
        const idSet = new Set(ids);
        for (const [wpId, marker] of markersRef.current) {
          marker.getElement().dataset.active = String(idSet.has(wpId));
        }
      },
      {
        equalityFn: (a, b) =>
          a.length === b.length && a.every((id, i) => id === b[i]),
        fireImmediately: true,
      }
    );

    const unsubMode = useRouteStore.subscribe(
      (s) => s.mode,
      (mode) => {
        stateRef.current.mode = mode;
        applyCursor();
      },
      { fireImmediately: true }
    );

    const unsubPencil = useRouteStore.subscribe(
      (s) => [s.pencilMode, s.selectShape] as const,
      ([pencilMode, selectShape]) => {
        stateRef.current.pencilMode = pencilMode;
        stateRef.current.selectShape = selectShape;
        applyCursor();
      },
      {
        equalityFn: ([a1, a2], [b1, b2]) => a1 === b1 && a2 === b2,
        fireImmediately: true,
      }
    );

    function applyCursor() {
      const map = mapRef.current;
      if (!map) return;
      const { mode, pencilMode } = stateRef.current;
      // Pencil-engaged finger interactions are pan-like; let the cursor
      // reflect that finger always pans now. The Pencil itself shows the
      // system stylus cursor, which we don't override.
      if (pencilMode !== "off") {
        map.getCanvas().style.cursor = "";
      } else {
        map.getCanvas().style.cursor = mode === "add" ? "crosshair" : "";
      }
    }

    return () => {
      unsubRoute();
      unsubSelected();
      unsubMode();
      unsubPencil();
    };
  }, []);

  // ---- Helpers (closure over markersRef) ----
  function syncRouteSource(map: MLMap) {
    const src = map.getSource(ROUTE_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    src.setData(buildRouteFC(stateRef.current.legs));
  }

  function syncMarkers(map: MLMap) {
    const wps = stateRef.current.waypoints;
    const existing = markersRef.current;
    const seen = new Set<string>();

    wps.forEach((wp, idx) => {
      seen.add(wp.id);
      let m = existing.get(wp.id);
      if (!m) {
        const el = document.createElement("div");
        el.className = "rm-marker";
        el.style.touchAction = "none";
        m = new Marker({ element: el, draggable: true, anchor: "center" });
        m.setLngLat(wp.pos);
        m.addTo(map);

        m.on("dragstart", () => {
          el.style.cursor = "grabbing";
          useRouteStore.getState().setSelected(wp.id);
        });
        m.on("dragend", () => {
          el.style.cursor = "grab";
          const ll = m!.getLngLat();
          void useRouteStore
            .getState()
            .moveWaypoint(wp.id, [ll.lng, ll.lat]);
        });
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const state = useRouteStore.getState();
          // In Pencil-select mode, marker tap toggles membership in the
          // multi-selection. In every other mode, marker tap toggles the
          // single-selection (and replaces any existing multi-selection).
          if (state.pencilMode === "select") {
            state.toggleSelected(wp.id);
          } else {
            const isOnly =
              state.selectedIds.length === 1 && state.selectedIds[0] === wp.id;
            state.setSelected(isOnly ? null : wp.id);
          }
        });
        existing.set(wp.id, m);
      } else {
        const ll = m.getLngLat();
        if (ll.lng !== wp.pos[0] || ll.lat !== wp.pos[1]) {
          m.setLngLat(wp.pos);
        }
      }
      // Update appearance based on position in route.
      const el = m.getElement();
      const kind =
        idx === 0
          ? "start"
          : idx === wps.length - 1 && wps.length > 1
            ? "end"
            : "mid";
      el.dataset.kind = kind;
      el.textContent = String(idx + 1);
      el.dataset.active = String(stateRef.current.selectedIds.includes(wp.id));
    });

    for (const [id, marker] of existing) {
      if (!seen.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }
  }

  function fitLoadedRoute(map: MLMap, routeId: string) {
    if (lastFitRouteIdRef.current === routeId) return;
    const bounds = boundsForCurrentRoute();
    if (!bounds) {
      lastFitRouteIdRef.current = routeId;
      return;
    }
    lastFitRouteIdRef.current = routeId;
    map.fitBounds(bounds, {
      padding: { top: 110, right: 80, bottom: 130, left: 90 },
      maxZoom: 16,
      duration: 500,
    });
  }

  function tryCenterOnStartupLocation(map: MLMap) {
    if (startupLocationAttemptedRef.current) return;
    startupLocationAttemptedRef.current = true;
    if (!isRouteEmpty()) return;

    if (!("geolocation" in navigator)) {
      onToast?.("Location is not available in this browser");
      return;
    }
    if (!window.isSecureContext) {
      onToast?.("Location needs HTTPS or localhost");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (mapRef.current !== map || !isRouteEmpty()) return;
        map.easeTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: Math.max(map.getZoom(), 14),
          duration: 600,
        });
      },
      (error) => {
        if (mapRef.current !== map || !isRouteEmpty()) return;
        console.warn("Startup geolocation failed:", error);
        onToast?.(messageForGeolocationError(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 8_000,
      }
    );
  }

  function isRouteEmpty() {
    return (
      stateRef.current.waypoints.length === 0 &&
      stateRef.current.legs.length === 0
    );
  }

  function boundsForCurrentRoute(): maplibregl.LngLatBounds | null {
    const coords: LngLat[] = [];
    for (const leg of stateRef.current.legs) {
      for (const coord of leg.coords) coords.push([coord[0], coord[1]]);
    }
    if (coords.length === 0) {
      for (const wp of stateRef.current.waypoints) coords.push(wp.pos);
    }
    if (coords.length === 0) return null;

    const bounds = coords.reduce(
      (b, coord) => b.extend(coord),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );

    // A single-point route has zero-area bounds; pad very slightly so
    // fitBounds can still center it without zooming to the maximum tile level.
    if (coords.length === 1) {
      const [lng, lat] = coords[0];
      bounds.extend([lng + 0.0005, lat + 0.0005]);
      bounds.extend([lng - 0.0005, lat - 0.0005]);
    }
    return bounds;
  }

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0"
        data-testid="rm-map"
        style={{ background: "#f8f4f0", width: "100%", height: "100%" }}
      />
      {penDraw && <PencilSelectionOverlay draw={penDraw} />}
      {initError && (
        <div className="pointer-events-none absolute inset-x-0 top-24 z-20 mx-auto max-w-md px-3">
          <div className="pointer-events-auto rounded-2xl bg-rose-600/95 p-3 text-sm text-white shadow-xl ring-1 ring-rose-300/40">
            <div className="flex items-start gap-3">
              <strong className="block flex-1">Map failed to load</strong>
              <button
                type="button"
                onClick={() => setInitError(null)}
                className="-mr-1 -mt-1 rounded-full px-2 py-1 text-xs font-semibold text-white/90 hover:bg-white/15"
                aria-label="Dismiss map error"
              >
                Close
              </button>
            </div>
            <code className="mt-1 block break-words font-mono text-xs opacity-90">
              {initError}
            </code>
            <p className="mt-1 text-xs opacity-80">
              Check the browser console for details. If you’re offline or behind
              a strict network, try a different connection.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

// Transient fetch errors for tiles, fonts, sprites etc. that should NOT
// surface as a fatal "Map failed to load" banner once the style is up.
// Browser variants:
//   - Safari:    "Load failed"
//   - Chromium:  "Failed to fetch" / "NetworkError"
//   - Workbox:   "FetchEvent.respondWith received an error: no-response: ..."
//                (happens when our service worker's runtime cache can't
//                produce a response — e.g. cross-origin font 404 on iPad PWA)
const RECOVERABLE_RESOURCE_ERROR_SUBSTRINGS = [
  "load failed",
  "failed to fetch",
  "networkerror",
  "no-response",
  "fetchevent.respondwith",
];

function isRecoverableMapResourceError(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return RECOVERABLE_RESOURCE_ERROR_SUBSTRINGS.some((needle) =>
    lower.includes(needle)
  );
}

function messageForGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission was denied";
    case error.POSITION_UNAVAILABLE:
      return "Could not find your location";
    case error.TIMEOUT:
      return "Location lookup timed out";
    default:
      return "Could not use your location";
  }
}

function buildRouteFC(legs: Leg[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = legs.map((leg, i) => ({
    type: "Feature",
    properties: { legIndex: i, status: leg.status },
    geometry: {
      type: "LineString",
      coordinates: leg.coords.map((c) => [c[0], c[1]]),
    },
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Compute which waypoints fall inside the in-progress Pencil-select shape.
 * Operates in canvas pixel space so the visual overlay and hit-test are
 * always in sync regardless of mid-drag map state.
 */
function hitTestSelection(
  map: MLMap,
  waypoints: Waypoint[],
  draw: PenDraw
): string[] {
  if (draw.type === "rect") {
    const [x0, y0] = draw.startPx;
    const [x1, y1] = draw.currentPx;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (maxX - minX < 4 || maxY - minY < 4) return [];
    return waypoints
      .filter((wp) => {
        const p = map.project(wp.pos);
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      })
      .map((wp) => wp.id);
  }
  // Lasso — point-in-polygon, closing the path with the implicit segment
  // from the last sample back to the first.
  if (draw.pathPx.length < 3) return [];
  return waypoints
    .filter((wp) => {
      const p = map.project(wp.pos);
      return pointInPolygon([p.x, p.y], draw.pathPx);
    })
    .map((wp) => wp.id);
}

/** Standard ray-casting point-in-polygon. `polygon` is treated as closed. */
function pointInPolygon(
  point: [number, number],
  polygon: [number, number][]
): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Find the waypoint nearest to a canvas pixel, within a touch-friendly
 * radius. Returns null if no waypoint is close enough — used for Pencil-tap
 * hit-testing in select mode.
 */
function pickWaypointAtPx(
  map: MLMap,
  waypoints: Waypoint[],
  px: [number, number]
): string | null {
  const RADIUS = 22; // px — slightly larger than the 28px marker radius
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const wp of waypoints) {
    const p = map.project(wp.pos);
    const d = Math.hypot(p.x - px[0], p.y - px[1]);
    if (d < RADIUS && d < bestDist) {
      bestDist = d;
      bestId = wp.id;
    }
  }
  return bestId;
}

/**
 * Live overlay of the Pencil-select shape. SVG sits over the map at
 * absolute position; pointer-events are disabled so it never interferes
 * with the actual canvas pointer pipeline.
 */
function PencilSelectionOverlay({ draw }: { draw: PenDraw }) {
  if (draw.type === "rect") {
    const [x0, y0] = draw.startPx;
    const [x1, y1] = draw.currentPx;
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    return (
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        aria-hidden
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="rgba(34, 197, 94, 0.12)"
          stroke="rgb(34, 197, 94)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      </svg>
    );
  }
  // Lasso: open path while drawing, with a thin closing segment back to start.
  const pts = draw.pathPx;
  if (pts.length < 2) return null;
  const polyPoints = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      aria-hidden
    >
      <polyline
        points={polyPoints}
        fill="rgba(34, 197, 94, 0.10)"
        stroke="rgb(34, 197, 94)"
        strokeWidth={1.75}
      />
      <line
        x1={ex}
        y1={ey}
        x2={sx}
        y2={sy}
        stroke="rgb(34, 197, 94)"
        strokeWidth={1.25}
        strokeDasharray="4 4"
        opacity={0.6}
      />
    </svg>
  );
}


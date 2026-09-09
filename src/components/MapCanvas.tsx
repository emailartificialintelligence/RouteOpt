"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

/*
 * Pinned to maplibre-gl 4.7.1. On 6.8.0 the basemap never renders — the style
 * and sprites load, then no vector tile is ever requested and no error is
 * raised. Confirmed in desktop Chrome, not just in CI. See MAPLIBRE_VERSION.md.
 *
 * v4 exposes a default export where v6 uses named exports, so this import is
 * the thing to change when the version moves.
 */
const { Map: MapLibreMap, Marker, NavigationControl, ScaleControl } = maplibregl;
type MapLibreMap = maplibregl.Map;
type Marker = maplibregl.Marker;
import "maplibre-gl/dist/maplibre-gl.css";
import { toLngLat } from "@/lib/schema";
import { draftBounds, displayName, type Draft } from "@/lib/plan";
import { routeColor } from "@/lib/routes";
import type { LngLat } from "@/lib/geometry";

/**
 * The map is the product. Everything else is a rail beside it.
 *
 * MapLibre owns imperative state and React owns declarative state, so the whole
 * job of this component is keeping the seam between them honest: the map is
 * built once, markers are reconciled against the draft, and coordinates cross
 * the boundary through toLngLat() rather than being flipped inline. That last
 * one is not fussiness — [lng, lat] versus { lat, lng } is the single most
 * common map bug, and it fails silently by putting a stop in another country.
 */

export type MapMode = "idle" | "add-stop" | "set-depot";

/** One vehicle's drawn line, already in [lng, lat]. */
export interface DrawnRoute {
  vehicleIndex: number;
  path: LngLat[];
  /** False when this is straight lines because road shapes were unavailable. */
  followsRoads: boolean;
}

interface MapCanvasProps {
  draft: Draft;
  /** Solved routes to draw. Empty until a plan exists. */
  routes: DrawnRoute[];
  /**
   * Changes when a new plan is solved, and only then. Swapping straight lines
   * for road geometry is not a new plan and must not replay the reveal.
   */
  planId: number;
  /**
   * Bumped when the caller wants the viewport re-framed — a pasted list, a CSV,
   * a depot lookup. Never bumped for a pin the user placed or dragged by hand.
   */
  fitRequest: number;
  mode: MapMode;
  selectedStopId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onStopMoved: (id: string, lat: number, lng: number) => void;
  onDepotMoved: (lat: number, lng: number) => void;
  onStopSelected: (id: string | null) => void;
  /** Called when the basemap fails. Pins keep working; the backdrop does not. */
  onBasemapError?: (message: string) => void;
  /**
   * A shared plan is somebody else's work. Pins can be inspected but not
   * dragged, and clicking the map adds nothing.
   */
  readOnly?: boolean;
}

/**
 * A muted basemap, because route colours have to sit on top of it and stay
 * distinguishable from each other. Overridable so a self-hosted or paid tile
 * source can be swapped in without touching this file.
 */
const BASEMAP_STYLE =
  process.env.NEXT_PUBLIC_BASEMAP_STYLE ??
  "https://tiles.openfreemap.org/styles/positron";

/** Paris. Somewhere to look while the first address is being typed. */
const INITIAL_CENTER: [number, number] = [2.3522, 48.8566];
const INITIAL_ZOOM = 11;

export function MapCanvas({
  draft,
  routes,
  planId,
  fitRequest,
  mode,
  selectedStopId,
  onMapClick,
  onStopMoved,
  onDepotMoved,
  onStopSelected,
  onBasemapError,
  readOnly = false,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /*
   * Marker and viewport effects need to run again once the map exists, and the
   * map may be built later than the first render — hence state, not just a ref.
   */
  const [mapReady, setMapReady] = useState(false);
  /*
   * Separate from mapReady: markers can be added to a map the moment it exists,
   * but sources and layers need the style parsed first. Gating route drawing on
   * a one-shot isStyleLoaded() check instead would drop the routes whenever a
   * solve returned before the style settled — and never retry, because the
   * plan does not change again.
   */
  const [styleReady, setStyleReady] = useState(false);
  /** Bumped when a not-yet-parsed style finishes, to re-run the route effect. */
  const [styleTick, setStyleTick] = useState(0);
  const stopMarkers = useRef(new Map<string, Marker>());
  const depotMarker = useRef<Marker | null>(null);
  /** Layer ids currently on the map, so stale vehicles can be removed. */
  const drawnRouteIds = useRef<Set<string>>(new Set());
  /** Pending reveal timers, cleared on unmount so they cannot fire into a dead map. */
  const revealTimers = useRef<number[]>([]);
  /** The plan whose reveal has already played. */
  const revealedPlan = useRef<number>(-1);

  /*
   * Handlers live in a ref so the map is built exactly once. Rebuilding it when
   * a callback identity changes would tear down the canvas mid-interaction and
   * lose the user's viewport.
   */
  const handlers = useRef({
    onMapClick,
    onStopMoved,
    onDepotMoved,
    onStopSelected,
    onBasemapError,
  });
  handlers.current = {
    onMapClick,
    onStopMoved,
    onDepotMoved,
    onStopSelected,
    onBasemapError,
  };

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /* ------------------------------------------------------------ build once */

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    let pendingSize: ResizeObserver | null = null;
    let sizeWatch: ResizeObserver | null = null;

    /*
     * Do not construct the map until its container has a real size.
     *
     * MapLibre measures the container once, in the constructor, and a map built
     * into a 0x0 box never finishes loading its style — no error, no tiles,
     * just a blank pane. Calling resize() afterwards does not rescue it. That
     * happens whenever the map mounts inside something not yet laid out: a
     * hidden tab, a collapsed panel, a mobile sheet that starts closed, or a
     * dynamic import that resolves before the grid has settled. Waiting for a
     * measurable box costs one frame and removes the whole class of bug.
     */
    const build = () => {
      if (cancelled) return;

    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => setStyleReady(true));

    /*
     * The basemap is a third-party service and it will be down sometimes. Pins,
     * the stop list and the routes all still work without it, so a tile failure
     * must not look like a broken app — it gets reported once, and the plan
     * carries on over a blank background.
     */
    map.on("error", (event) => {
      const message = event.error?.message ?? "Unknown map error";
      console.warn("[map]", message);
      handlers.current.onBasemapError?.(message);
    });

    map.on("click", (event) => {
      if (readOnlyRef.current || modeRef.current === "idle") {
        handlers.current.onStopSelected(null);
        return;
      }
      const { lat, lng } = event.lngLat;
      handlers.current.onMapClick(lat, lng);
    });

      /*
       * Keep watching after construction. On a phone the rail is a bottom sheet
       * whose height changes as the list grows, and a window resize moves the
       * split too; either way the canvas has to follow its box.
       */
      sizeWatch = new ResizeObserver(() => map.resize());
      sizeWatch.observe(container);

      mapRef.current = map;
      setMapReady(true);
    };

    const measurable = () =>
      container.clientWidth > 0 && container.clientHeight > 0;

    if (measurable()) {
      build();
    } else {
      pendingSize = new ResizeObserver(() => {
        if (measurable()) {
          pendingSize?.disconnect();
          pendingSize = null;
          build();
        }
      });
      pendingSize.observe(container);
    }

    return () => {
      cancelled = true;
      pendingSize?.disconnect();
      sizeWatch?.disconnect();
      // A pending reveal must not fire into a map that has been torn down.
      for (const timer of revealTimers.current) window.clearTimeout(timer);
      revealTimers.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
      setStyleReady(false);
      stopMarkers.current.clear();
      depotMarker.current = null;
    };
  }, []);

  /* -------------------------------------------------------------- the depot */

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const { lat, lng } = draft.depot;

    if (lat === null || lng === null) {
      depotMarker.current?.remove();
      depotMarker.current = null;
      return;
    }

    if (!depotMarker.current) {
      const element = document.createElement("div");
      // classList, not className, for the same reason as the stop markers:
      // never clobber the maplibregl-marker class that positions the element.
      element.classList.add("marker", "marker--depot");
      element.title = readOnly ? "Depot" : "Depot — drag to move";
      // A square, and the letter D. Two signals, so neither has to carry it alone.
      element.textContent = "D";
      element.setAttribute("aria-label", "Depot");

      const marker = new Marker({ element, draggable: !readOnly })
        .setLngLat(toLngLat({ lat, lng }))
        .addTo(map);

      if (!readOnly) {
        marker.on("dragend", () => {
          const position = marker.getLngLat();
          handlers.current.onDepotMoved(position.lat, position.lng);
        });
      }

      depotMarker.current = marker;
      return;
    }

    depotMarker.current.setLngLat(toLngLat({ lat, lng }));
  }, [draft.depot, mapReady, readOnly]);

  /* --------------------------------------------------------------- the stops */

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const live = new Set<string>();

    draft.stops.forEach((stop, index) => {
      if (stop.lat === null || stop.lng === null) return;
      live.add(stop.id);

      const position = toLngLat({ lat: stop.lat, lng: stop.lng });

      /*
       * Toggle only our own classes, never assign className.
       *
       * MapLibre puts maplibregl-marker on the element itself, and that class
       * is what carries position:absolute. Overwriting className strips it, the
       * marker drops into normal document flow, and MapLibre's transform then
       * offsets it from its flow position rather than from the map origin — so
       * the pins stack in a vertical column, spread far wider than the real
       * coordinates, and stop tracking pan and zoom.
       */
      const applyState = (element: HTMLElement) => {
        element.classList.add("marker", "marker--stop");
        element.classList.toggle("marker--review", stop.status === "review");
        element.classList.toggle("marker--selected", stop.id === selectedStopId);
      };

      const existing = stopMarkers.current.get(stop.id);
      if (existing) {
        const element = existing.getElement();
        applyState(element);
        element.textContent = String(index + 1);
        element.title = displayName(stop, index);
        existing.setLngLat(position);
        return;
      }

      const element = document.createElement("div");
      applyState(element);
      element.textContent = String(index + 1);
      element.title = displayName(stop, index);
      element.setAttribute("aria-label", `Stop ${index + 1}: ${displayName(stop, index)}`);

      const marker = new Marker({ element, draggable: !readOnly })
        .setLngLat(position)
        .addTo(map);

      element.addEventListener("click", (event) => {
        // Otherwise the map's own click handler clears the selection we just made.
        event.stopPropagation();
        handlers.current.onStopSelected(stop.id);
      });

      if (!readOnly) {
        marker.on("dragstart", () => element.classList.add("marker--dragging"));
        marker.on("dragend", () => {
          element.classList.remove("marker--dragging");
          const moved = marker.getLngLat();
          handlers.current.onStopMoved(stop.id, moved.lat, moved.lng);
        });
      }

      stopMarkers.current.set(stop.id, marker);
    });

    for (const [id, marker] of stopMarkers.current) {
      if (!live.has(id)) {
        marker.remove();
        stopMarkers.current.delete(id);
      }
    }
  }, [draft.stops, selectedStopId, mapReady, readOnly]);

  /* ------------------------------------------------------------- the routes */

  /*
   * Routes are a GeoJSON source plus two line layers per vehicle. They sit
   * beneath the markers, because a pin a driver has to read must never be
   * covered by a line.
   *
   * The reveal — routes drawing on one vehicle after another — is the only
   * motion in the product, and it fires once per solve. It is keyed on planId
   * rather than on the route data because the road geometry arrives a moment
   * after the plan and replaces the straight lines; replaying the animation for
   * that would make a cosmetic upgrade look like a second solve. Worse, hiding
   * every line on each data change means one interrupted timer leaves a route
   * invisible for good.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    /*
     * The load event is necessary but not sufficient. A style can be
     * re-parsing — after a hot reload in development, or a basemap swap —
     * and addSource() throws "Style is not done loading" if it is. Waiting for
     * the next idle and re-running is the only safe way in: returning without
     * rescheduling would drop the routes permanently, since the plan does not
     * change again on its own.
     */
    if (!map.isStyleLoaded()) {
      const retry = () => setStyleTick((tick) => tick + 1);
      map.once("idle", retry);
      return () => {
        map.off("idle", retry);
      };
    }

    const wanted = new Set(routes.map((r) => `route-${r.vehicleIndex}`));

    for (const id of drawnRouteIds.current) {
      if (wanted.has(id)) continue;
      if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
      if (map.getLayer(`${id}-casing`)) map.removeLayer(`${id}-casing`);
      if (map.getSource(id)) map.removeSource(id);
    }
    drawnRouteIds.current = wanted;

    const firstDrawOfThisPlan = revealedPlan.current !== planId;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const [order, route] of routes.entries()) {
      const id = `route-${route.vehicleIndex}`;
      const color = routeColor(route.vehicleIndex);
      const data: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: route.path },
      };

      const existing = map.getSource(id);
      if (existing && "setData" in existing) {
        (existing as maplibregl.GeoJSONSource).setData(data);
      } else {
        map.addSource(id, { type: "geojson", data });

        /*
         * A pale casing under each line. Where two vehicles share a street the
         * casing keeps the upper line readable instead of the two colours
         * blending into an ambiguous third.
         */
        map.addLayer({
          id: `${id}-casing`,
          type: "line",
          source: id,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#FBFAF7", "line-width": 6, "line-opacity": 0.9 },
        });

        map.addLayer({
          id: `${id}-line`,
          type: "line",
          source: id,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 3 },
        });
      }

      map.setPaintProperty(`${id}-line`, "line-color", color);

      /*
       * Dashes mean "this is a straight line between stops, not a road". It has
       * to be set on every update, not just at creation: the first draw is
       * always straight lines and the road shapes replace them a moment later,
       * so a dash applied once would never come off.
       */
      map.setPaintProperty(
        `${id}-line`,
        "line-dasharray",
        route.followsRoads ? [1, 0] : [2, 1.5],
      );

      if (!firstDrawOfThisPlan) continue;

      if (reduceMotion) {
        map.setPaintProperty(`${id}-line`, "line-opacity", 1);
        map.setPaintProperty(`${id}-casing`, "line-opacity", 0.9);
        continue;
      }

      map.setPaintProperty(`${id}-line`, "line-opacity-transition", { duration: 0 });
      map.setPaintProperty(`${id}-casing`, "line-opacity-transition", { duration: 0 });
      map.setPaintProperty(`${id}-line`, "line-opacity", 0);
      map.setPaintProperty(`${id}-casing`, "line-opacity", 0);

      const timer = window.setTimeout(() => {
        const live = mapRef.current;
        if (!live?.getLayer(`${id}-line`)) return;
        live.setPaintProperty(`${id}-line`, "line-opacity-transition", { duration: 420 });
        live.setPaintProperty(`${id}-casing`, "line-opacity-transition", { duration: 420 });
        live.setPaintProperty(`${id}-line`, "line-opacity", 1);
        live.setPaintProperty(`${id}-casing`, "line-opacity", 0.9);
      }, order * 140);
      revealTimers.current.push(timer);
    }

    if (routes.length > 0) revealedPlan.current = planId;
  }, [routes, planId, styleReady, styleTick]);

  /* ------------------------------------------------------------ the viewport */

  /*
   * Re-frame only when asked, never because the stops changed.
   *
   * Fitting on every change is the obvious implementation and it is wrong: it
   * fires on each pin the user clicks onto the map, so the view jumps out from
   * under the hand that is placing them and the next click lands somewhere
   * unintended. Dragging a pin does the same. From the user's side the pins
   * look like they are moving on their own — the map moved, not the pins.
   *
   * So the caller decides. A pasted list or a depot lookup is worth framing;
   * hand-placement is not, because the user is already looking exactly where
   * they want to be.
   */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitRequest === 0) return;

    const bounds = draftBounds(draftRef.current);
    if (!bounds) return;

    const sw: [number, number] = [bounds.west, bounds.south];
    const ne: [number, number] = [bounds.east, bounds.north];

    map.fitBounds([sw, ne], {
      // Room for the pin above its own anchor, and for the rail on the left.
      padding: { top: 72, bottom: 72, left: 48, right: 48 },
      maxZoom: 15,
      duration: 0,
    });
  }, [fitRequest, mapReady]);

  return (
    <div
      ref={containerRef}
      className={mode === "idle" ? "map" : "map map--placing"}
      style={{ position: "absolute", inset: 0 }}
      // The map is a visual aid to the stop list, which is the accessible
      // source of truth. Announcing every pin here would double-read it.
      aria-hidden="true"
    />
  );
}

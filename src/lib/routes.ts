import type { Problem, Route, Solution, Stop } from "./schema";
import type { DraftStop } from "./plan";

/**
 * Presentation helpers for a solved plan. Pure: no fetching, no DOM.
 */

/**
 * Route colours, in assignment order.
 *
 * Chosen to stay distinguishable from each other against a muted basemap, and
 * to survive being printed in black and white at different weights — a driver's
 * manifest often comes off a mono laser printer, and a palette that collapses
 * into four identical greys makes the map useless on paper.
 */
export const ROUTE_COLORS = [
  "#0B5D8A",
  "#B3261E",
  "#1B7A3E",
  "#8A5A00",
  "#6B3FA0",
  "#B8005C",
  "#00706B",
  "#A03E00",
] as const;

/** Wraps rather than running out. More vehicles than colours is legal. */
export function routeColor(vehicleIndex: number): string {
  return ROUTE_COLORS[vehicleIndex % ROUTE_COLORS.length];
}

/* ------------------------------------------------------- draft to problem */

export interface PlanOptions {
  vehicleCount: number;
  objective: "distance" | "balanced";
  roundTrip: boolean;
  solver: "greedy" | "ortools" | "pyvrp" | "vroom";
  defaultServiceTime: number;
}

export const defaultPlanOptions: PlanOptions = {
  vehicleCount: 2,
  objective: "balanced",
  roundTrip: true,
  solver: "greedy",
  defaultServiceTime: 300,
};

/**
 * Turn the editable draft into the wire Problem the API expects.
 *
 * Stops without coordinates are dropped rather than sent as nulls: the schema
 * would reject the whole request, and the caller has already been told through
 * the readiness summary that those stops are not ready. Returns null when there
 * is nothing solvable, so the caller never posts a request it knows will fail.
 */
export function draftToProblem(
  depot: { lat: number | null; lng: number | null; label?: string; address?: string },
  stops: DraftStop[],
  options: PlanOptions,
): Problem | null {
  if (depot.lat === null || depot.lng === null) return null;

  const placed = stops.filter(
    (s): s is DraftStop & { lat: number; lng: number } =>
      s.lat !== null && s.lng !== null,
  );
  if (placed.length === 0) return null;

  const wireStops: Stop[] = placed.map((s) => ({
    id: s.id,
    label: s.label,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    demand: null,
    timeWindow: null,
    serviceTime: null,
    priority: null,
  }));

  // The UI collects a number; the schema needs objects. One conversion, here.
  const vehicles = Array.from({ length: Math.max(1, options.vehicleCount) }, (_, i) => ({
    id: `v${i + 1}`,
    label: `Van ${i + 1}`,
    capacity: null,
    start: null,
    end: null,
    profile: "driving" as const,
    maxDuration: null,
  }));

  return {
    version: 1,
    depot: {
      lat: depot.lat,
      lng: depot.lng,
      label: depot.label,
      address: depot.address,
    },
    stops: wireStops,
    vehicles,
    options: {
      objective: options.objective,
      roundTrip: options.roundTrip,
      defaultServiceTime: options.defaultServiceTime,
      solver: options.solver,
      timeBudgetMs: 10_000,
    },
  };
}

/* ------------------------------------------------------------- geometry */

/**
 * The ordered coordinates a vehicle actually drives, as [lng, lat].
 *
 * Depot first, then each stop in sequence, then back to the depot when the plan
 * is a round trip. This is the input both to the map polyline and to the road
 * geometry lookup, so the two can never disagree about the order of the stops.
 */
export function routePath(
  problem: Problem,
  route: Route,
): [number, number][] {
  const depot: [number, number] = [problem.depot.lng, problem.depot.lat];
  const path: [number, number][] = [depot];

  for (const stop of route.stops) {
    const source = problem.stops[stop.stopIndex];
    if (source) path.push([source.lng, source.lat]);
  }

  if (problem.options.roundTrip && route.stops.length > 0) path.push(depot);
  return path;
}

/* --------------------------------------------------------- Google Maps */

/** Google caps a directions URL at this many waypoints between the ends. */
const MAX_WAYPOINTS = 23;

export interface MapsLink {
  url: string;
  /** True when the route was too long and some stops were left out. */
  truncated: boolean;
  omitted: number;
}

/**
 * A Google Maps directions link for one vehicle, for the driver's phone.
 *
 * Google's directions URL takes a limited number of waypoints. Rather than
 * producing a link that silently drops the tail of a route — a driver would
 * follow it to the end and simply never reach the last stops — this reports
 * what was left off so the UI can say so.
 */
export function googleMapsLink(path: [number, number][]): MapsLink | null {
  if (path.length < 2) return null;

  const asLatLng = (c: [number, number]) => `${c[1]},${c[0]}`;
  const origin = path[0];
  const destination = path[path.length - 1];
  const middle = path.slice(1, -1);

  const kept = middle.slice(0, MAX_WAYPOINTS);
  const omitted = middle.length - kept.length;

  const params = new URLSearchParams({
    api: "1",
    origin: asLatLng(origin),
    destination: asLatLng(destination),
    travelmode: "driving",
  });
  if (kept.length > 0) {
    params.set("waypoints", kept.map(asLatLng).join("|"));
  }

  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    truncated: omitted > 0,
    omitted,
  };
}

/* ------------------------------------------------------------ manifest */

export interface ManifestRow {
  sequence: number;
  name: string;
  arrivalOffset: number;
  distanceFromPrevious: number;
}

/** What a driver reads, in order. Never blank, never an internal id. */
export function manifestRows(
  problem: Problem,
  route: Route,
): ManifestRow[] {
  return route.stops.map((stop) => {
    const source = problem.stops[stop.stopIndex];
    return {
      sequence: stop.sequence + 1,
      name:
        source?.label ??
        source?.address ??
        `Stop ${stop.stopIndex + 1}`,
      arrivalOffset: stop.arrivalOffset,
      distanceFromPrevious: stop.distanceFromPrevious,
    };
  });
}

/** Routes with no work, so the UI can say "2 of 3 vans used" honestly. */
export function idleVehicles(solution: Solution): number {
  return solution.routes.filter((r) => r.stops.length === 0).length;
}

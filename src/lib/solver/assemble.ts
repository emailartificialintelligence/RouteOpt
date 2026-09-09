import {
  SCHEMA_VERSION,
  serviceTimeFor,
  type Problem,
  type Route,
  type RouteStop,
  type Solution,
  type SolverName,
} from "../schema";
import { DEPOT_INDEX, matrixIndexForStop, type Matrix } from "./types";

/**
 * Turning an assignment into a Solution.
 *
 * Every engine decides the same thing — which stops each vehicle visits, and in
 * what order. Everything after that is arithmetic: leg distances, cumulative
 * arrival offsets with service time, per-route totals, the baseline to compare
 * against. That arithmetic is identical for every engine and must stay
 * identical, because the comparison view puts their numbers side by side and a
 * difference there has to mean a difference in routing, not a difference in how
 * two implementations happened to add up minutes.
 *
 * Extracted from greedy.ts when the second engine arrived, for exactly that
 * reason. Duplicating it across engines — worse, across languages, with the
 * OR-Tools sidecar in Python — is how two solvers silently disagree about the
 * same route.
 */

/** One vehicle's work, as matrix indices in visit order. */
export type VehicleOrder = number[];

export function buildRoute(
  problem: Problem,
  matrix: Matrix,
  vehicleIndex: number,
  matrixOrder: VehicleOrder,
): Route {
  const vehicle = problem.vehicles[vehicleIndex];
  const { roundTrip } = problem.options;

  const stops: RouteStop[] = [];
  let cursor = DEPOT_INDEX;
  let distance = 0;
  let elapsed = 0;
  let load = 0;

  matrixOrder.forEach((mIdx, seq) => {
    const legDistance = matrix.distances[cursor][mIdx];
    const legDuration = matrix.durations[cursor][mIdx];
    distance += legDistance;
    elapsed += legDuration;

    const stopIndex = mIdx - 1;
    const stop = problem.stops[stopIndex];
    load += stop.demand ?? 0;

    stops.push({
      stopId: stop.id,
      stopIndex,
      sequence: seq,
      arrivalOffset: Math.round(elapsed),
      distanceFromPrevious: legDistance,
      durationFromPrevious: legDuration,
    });

    elapsed += serviceTimeFor(stop, problem.options);
    cursor = mIdx;
  });

  if (roundTrip && matrixOrder.length > 0) {
    distance += matrix.distances[cursor][DEPOT_INDEX];
    elapsed += matrix.durations[cursor][DEPOT_INDEX];
  }

  return {
    vehicleId: vehicle.id,
    vehicleLabel: vehicle.label,
    vehicleIndex,
    stops,
    totalDistance: Math.round(distance),
    totalDuration: Math.round(elapsed),
    totalLoad: load,
  };
}

/**
 * Visiting stops in input order with one vehicle. Powers "down from X km".
 *
 * This is the number the product's core claim rests on, so it is computed the
 * same way for every engine.
 */
export function baselineDistance(problem: Problem, matrix: Matrix): number {
  const order = problem.stops.map((_, i) => matrixIndexForStop(i));
  let total = 0;
  let cursor = DEPOT_INDEX;
  for (const m of order) {
    total += matrix.distances[cursor][m];
    cursor = m;
  }
  if (problem.options.roundTrip) total += matrix.distances[cursor][DEPOT_INDEX];
  return Math.round(total);
}

export interface AssembleOptions {
  solver: SolverName;
  solveTimeMs: number;
  warnings?: string[];
}

/**
 * One assignment, one Solution.
 *
 * `orders` is indexed by vehicle: orders[2] is the third vehicle's stops as
 * matrix indices. A vehicle with no work gets an empty array and still appears
 * in the solution, so "2 of 3 vans used" can be said honestly.
 */
export function assembleSolution(
  problem: Problem,
  matrix: Matrix,
  orders: VehicleOrder[],
  options: AssembleOptions,
): Solution {
  const warnings = [...(options.warnings ?? [])];

  const routes = problem.vehicles.map((_, vehicleIndex) =>
    buildRoute(problem, matrix, vehicleIndex, orders[vehicleIndex] ?? []),
  );

  const totalDistance = routes.reduce((s, r) => s + r.totalDistance, 0);
  const totalDuration = routes.reduce((s, r) => s + r.totalDuration, 0);
  const longest = routes.reduce((m, r) => Math.max(m, r.totalDistance), 0);
  const stopsServed = routes.reduce((s, r) => s + r.stops.length, 0);

  /*
   * No warning about straight-line distances here. The matrix layer already
   * emits one on every path that returns a haversine matrix, and the route
   * handler merges the two lists — so adding a second sentence saying the same
   * thing put two near-identical warnings in front of the user. meta.matrixSource
   * carries the fact for anyone who needs to branch on it.
   */

  return {
    version: SCHEMA_VERSION,
    routes,
    summary: {
      totalDistance,
      totalDuration,
      longestRouteDistance: longest,
      vehiclesUsed: routes.filter((r) => r.stops.length > 0).length,
      stopsServed,
      baselineDistance: baselineDistance(problem, matrix),
    },
    meta: {
      solver: options.solver,
      solveTimeMs: options.solveTimeMs,
      matrixSource: matrix.source,
      warnings,
    },
  };
}

/**
 * Every stop served exactly once, and nothing invented.
 *
 * An engine that drops a stop produces a plan that looks entirely plausible —
 * shorter, even — and a delivery that never happens. An engine that repeats one
 * sends two drivers to the same door. Neither is visible on a map, so both are
 * checked here before a Solution is returned to anyone.
 */
export function assertServesEveryStop(
  problem: Problem,
  orders: VehicleOrder[],
): void {
  const seen = new Set<number>();
  for (const order of orders) {
    for (const matrixIndex of order) {
      if (matrixIndex === DEPOT_INDEX) {
        throw new Error("A route includes the depot as a stop.");
      }
      if (seen.has(matrixIndex)) {
        throw new Error(`Stop ${matrixIndex - 1} is visited more than once.`);
      }
      seen.add(matrixIndex);
    }
  }
  if (seen.size !== problem.stops.length) {
    throw new Error(
      `Plan serves ${seen.size} of ${problem.stops.length} stops.`,
    );
  }
}

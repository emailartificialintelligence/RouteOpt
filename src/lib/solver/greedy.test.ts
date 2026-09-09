import { describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "../schema";
import { greedySolver, haversine } from "./greedy";
import type { Matrix } from "./types";

/**
 * These tests exist because solver bugs are silent. A wrong route still renders
 * as a plausible polyline, so nothing looks broken until a driver is halfway
 * across town. The invariants below are the ones worth guarding.
 */

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function makeStops(count: number, spread = 0.09) {
  const r = seeded(42);
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    label: `Stop ${i}`,
    lat: DEPOT.lat + (r() - 0.5) * spread,
    lng: DEPOT.lng + (r() - 0.5) * spread * 1.3,
    demand: null,
    timeWindow: null,
    serviceTime: null,
    priority: null,
  }));
}

function makeProblem(
  stopCount: number,
  vehicleCount: number,
  options: Partial<Problem["options"]> = {},
): Problem {
  return ProblemSchema.parse({
    depot: DEPOT,
    stops: makeStops(stopCount),
    vehicles: expandVehicleCount(vehicleCount),
    options: { solver: "greedy", ...options },
  });
}

function makeMatrix(problem: Problem): Matrix {
  const coords = [
    { lat: problem.depot.lat, lng: problem.depot.lng },
    ...problem.stops,
  ];
  const n = coords.length;
  const distances = Array.from({ length: n }, () => new Array(n).fill(0));
  const durations = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(coords[i], coords[j]) * 1.3;
      distances[i][j] = distances[j][i] = d;
      durations[i][j] = durations[j][i] = d / 8.3;
    }
  }
  return { distances, durations, source: "haversine", size: n };
}

describe("greedy solver", () => {
  it("serves every stop exactly once", () => {
    const problem = makeProblem(30, 4);
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    const served = solution.routes.flatMap((r) => r.stops.map((s) => s.stopId));
    expect(served).toHaveLength(30);
    expect(new Set(served).size).toBe(30);
  });

  it("beats the input-order baseline", () => {
    const problem = makeProblem(25, 3);
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    // This is the number shown to the user as "down from X km". If it ever goes
    // the wrong way, the product's core claim is false.
    expect(solution.summary.totalDistance).toBeLessThan(
      solution.summary.baselineDistance,
    );
  });

  it("balances stop counts under the balanced objective", () => {
    const problem = makeProblem(24, 3, { objective: "balanced" });
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    const counts = solution.routes.map((r) => r.stops.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("produces a shorter longest-route when balancing", () => {
    const stops = makeStops(30);
    const base = { depot: DEPOT, stops, vehicles: expandVehicleCount(3) };
    const balanced = ProblemSchema.parse({
      ...base,
      options: { solver: "greedy", objective: "balanced" },
    });
    const byDistance = ProblemSchema.parse({
      ...base,
      options: { solver: "greedy", objective: "distance" },
    });
    const matrix = makeMatrix(balanced);
    const a = greedySolver.solve(balanced, matrix);
    const b = greedySolver.solve(byDistance, matrix);
    // The whole point of exposing the toggle: the two objectives must actually
    // differ, or the control is decorative.
    expect(a.summary.longestRouteDistance).not.toBe(b.summary.longestRouteDistance);
  });

  it("is deterministic", () => {
    const problem = makeProblem(20, 3);
    const matrix = makeMatrix(problem);
    const a = greedySolver.solve(problem, matrix);
    const b = greedySolver.solve(problem, matrix);
    expect(a.summary.totalDistance).toBe(b.summary.totalDistance);
    expect(a.routes.map((r) => r.stops.map((s) => s.stopId))).toEqual(
      b.routes.map((r) => r.stops.map((s) => s.stopId)),
    );
  });

  it("handles more vehicles than stops", () => {
    const problem = makeProblem(2, 5);
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    expect(solution.routes).toHaveLength(5);
    expect(solution.summary.stopsServed).toBe(2);
    expect(solution.summary.vehiclesUsed).toBe(2);
    expect(solution.meta.warnings.length).toBeGreaterThan(0);
  });

  it("handles a single stop", () => {
    const problem = makeProblem(1, 1);
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    expect(solution.routes[0].stops).toHaveLength(1);
  });

  it("handles coincident stops without dropping any", () => {
    const duplicate = { ...makeStops(1)[0] };
    const problem = ProblemSchema.parse({
      depot: DEPOT,
      stops: [0, 1, 2, 3, 4].map((i) => ({ ...duplicate, id: `dup${i}` })),
      vehicles: expandVehicleCount(2),
      options: { solver: "greedy" },
    });
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    expect(solution.summary.stopsServed).toBe(5);
  });

  it("adds the return leg only on round trips", () => {
    const stops = makeStops(10);
    const base = { depot: DEPOT, stops, vehicles: expandVehicleCount(1) };
    const closed = ProblemSchema.parse({
      ...base,
      options: { solver: "greedy", roundTrip: true },
    });
    const open = ProblemSchema.parse({
      ...base,
      options: { solver: "greedy", roundTrip: false },
    });
    const matrix = makeMatrix(closed);
    expect(greedySolver.solve(open, matrix).summary.totalDistance).toBeLessThan(
      greedySolver.solve(closed, matrix).summary.totalDistance,
    );
  });

  it("accumulates service time into arrival offsets", () => {
    const problem = makeProblem(5, 1, { defaultServiceTime: 600 });
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    const [first, second] = solution.routes[0].stops;
    // Second arrival must include the first stop's 10 minutes of service.
    expect(second.arrivalOffset).toBeGreaterThanOrEqual(
      first.arrivalOffset + 600,
    );
  });

  it("records that distances are approximate", () => {
    /*
     * The solver reports the fact; the matrix layer owns the sentence.
     *
     * This used to assert a "straight-line" warning here too, but matrix.ts
     * emits one on every path that returns a haversine matrix and the route
     * handler merges both lists — so the user saw two near-identical warnings.
     * The wording is asserted where it is produced (matrix.test.ts) and where
     * it reaches the client (the solve route tests); what belongs here is the
     * machine-readable flag the UI branches on.
     */
    const problem = makeProblem(5, 1);
    const solution = greedySolver.solve(problem, makeMatrix(problem));
    expect(solution.meta.matrixSource).toBe("haversine");
  });
});

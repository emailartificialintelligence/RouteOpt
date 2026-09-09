import { describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "../schema";
import { greedySolver, haversine } from "./greedy";
import type { Matrix } from "./types";

/**
 * Instances whose optimum is known by construction.
 *
 * The statistical tests in greedy.test.ts prove the solver improves on the
 * input order. These prove it actually finds the answer on shapes small enough
 * to reason about, which is the only way to catch a sequencing bug that merely
 * makes routes worse instead of wrong.
 *
 * Everything sits on the equator, where a line of constant latitude is a great
 * circle and haversine distances along it are exactly additive. That makes the
 * optimal tour arithmetic rather than approximate.
 */

const EQUATOR = { lat: 0, lng: 0 };

function stopAt(id: string, lat: number, lng: number) {
  return {
    id,
    label: id,
    lat,
    lng,
    demand: null,
    timeWindow: null,
    serviceTime: null,
    priority: null,
  };
}

function euclideanMatrix(problem: Problem): Matrix {
  const coords = [
    { lat: problem.depot.lat, lng: problem.depot.lng },
    ...problem.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
  const n = coords.length;
  const distances = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const durations = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(coords[i], coords[j]);
      distances[i][j] = distances[j][i] = d;
      durations[i][j] = durations[j][i] = d / 10;
    }
  }
  return { distances, durations, source: "haversine", size: n };
}

describe("known-optimal instances", () => {
  it("sequences collinear stops in order, out and back", () => {
    // Depot at 0; stops strung along the equator. The only optimal round trip
    // is to run to the far end and return, so total = 2 x the span.
    // Input order is scrambled: a solver that just echoes input passes nothing.
    const problem = ProblemSchema.parse({
      depot: EQUATOR,
      stops: [
        stopAt("c", 0, 0.03),
        stopAt("a", 0, 0.01),
        stopAt("d", 0, 0.04),
        stopAt("b", 0, 0.02),
      ],
      vehicles: expandVehicleCount(1),
      options: { solver: "greedy", roundTrip: true, defaultServiceTime: 0 },
    });
    const matrix = euclideanMatrix(problem);
    const solution = greedySolver.solve(problem, matrix);

    expect(solution.routes[0].stops.map((s) => s.stopId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);

    const span = haversine(EQUATOR, { lat: 0, lng: 0.04 });
    expect(solution.summary.totalDistance).toBe(Math.round(2 * span));
  });

  it("walks the perimeter of a square rather than crossing it", () => {
    // Depot at a corner, stops at the other three. The perimeter tour costs
    // 4s; every crossing tour costs more. This is the case 2-opt exists for.
    const s = 0.02;
    const problem = ProblemSchema.parse({
      depot: EQUATOR,
      stops: [
        stopAt("far", s, s), // diagonal corner, deliberately listed first
        stopAt("east", 0, s),
        stopAt("north", s, 0),
      ],
      vehicles: expandVehicleCount(1),
      options: { solver: "greedy", roundTrip: true, defaultServiceTime: 0 },
    });
    const matrix = euclideanMatrix(problem);
    const solution = greedySolver.solve(problem, matrix);

    const visited = solution.routes[0].stops.map((st) => st.stopId);
    // Either direction around the perimeter is optimal; the diagonal corner
    // must land in the middle.
    expect(visited[1]).toBe("far");

    const side = haversine(EQUATOR, { lat: 0, lng: s });
    const perimeter = 4 * side;
    // Tolerance covers the square's sides differing by a few metres because a
    // degree of latitude and a degree of longitude are not identical lengths.
    expect(solution.summary.totalDistance).toBeLessThanOrEqual(
      Math.round(perimeter * 1.001),
    );
  });

  it("gives each vehicle its own cluster instead of interleaving them", () => {
    // Two tight clusters far apart, two vehicles. Any plan that sends a vehicle
    // to both clusters is the crossing-routes failure users read as "broken".
    const west = [0, 1, 2].map((i) => stopAt(`w${i}`, 0, -0.05 + i * 0.002));
    const east = [0, 1, 2].map((i) => stopAt(`e${i}`, 0, 0.05 + i * 0.002));
    const problem = ProblemSchema.parse({
      depot: EQUATOR,
      stops: [west[0], east[0], west[1], east[1], west[2], east[2]],
      vehicles: expandVehicleCount(2),
      options: { solver: "greedy", objective: "balanced" },
    });
    const solution = greedySolver.solve(problem, euclideanMatrix(problem));

    for (const route of solution.routes) {
      const sides = new Set(route.stops.map((st) => st.stopId[0]));
      expect(sides.size).toBe(1);
    }
  });
});

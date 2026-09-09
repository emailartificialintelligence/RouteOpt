import type { Problem, Solution } from "../schema";
import { DEPOT_INDEX, matrixIndexForStop, type Matrix, type Solver } from "./types";
import { assembleSolution, type VehicleOrder } from "./assemble";

/**
 * Cluster-first, route-second.
 *
 * Assignment before sequencing is what stops routes from visually crossing each
 * other. A global nearest-neighbour sweep that opens a new vehicle when the
 * current one fills produces interleaved, overlapping polylines, and users read
 * crossing lines as a broken optimizer even when total distance is fine.
 * Perceived quality on a map is mostly about routes not overlapping.
 *
 *   1. partition stops into k geographic clusters (k = vehicle count)
 *   2. sequence each cluster: nearest neighbour, then 2-opt, then Or-opt
 *
 * Objective changes step 1 only:
 *   "distance" — plain k-means, natural clusters, uneven workloads
 *   "balanced" — capacity-constrained k-means, near-equal stop counts
 */

interface Point {
  lat: number;
  lng: number;
  /** index into problem.stops */
  index: number;
}

/* --------------------------------------------------------------- geometry */

const EARTH_RADIUS_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Equirectangular projection to local meters, centered on the depot.
 * Clustering in raw lat/lng distorts badly away from the equator: one degree of
 * longitude is 111km at the equator and 71km in Paris, so k-means on raw
 * coordinates produces clusters stretched east-west.
 */
function project(
  p: { lat: number; lng: number },
  origin: { lat: number; lng: number },
): [number, number] {
  const x = toRad(p.lng - origin.lng) * Math.cos(toRad(origin.lat)) * EARTH_RADIUS_M;
  const y = toRad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return [x, y];
}

const sqDist = (a: [number, number], b: [number, number]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/* --------------------------------------------------------------- clustering */

/** Deterministic PRNG so identical input always produces an identical plan. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kMeansPlusPlusInit(
  pts: [number, number][],
  k: number,
  rand: () => number,
): [number, number][] {
  const centroids: [number, number][] = [pts[Math.floor(rand() * pts.length)]];
  while (centroids.length < k) {
    const d2 = pts.map((p) =>
      Math.min(...centroids.map((c) => sqDist(p, c))),
    );
    const total = d2.reduce((s, v) => s + v, 0);
    if (total === 0) {
      // All remaining points coincide with a centroid. Pad and stop.
      centroids.push(pts[centroids.length % pts.length]);
      continue;
    }
    let r = rand() * total;
    let chosen = 0;
    for (let i = 0; i < d2.length; i++) {
      r -= d2[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(pts[chosen]);
  }
  return centroids;
}

function lloyd(
  pts: [number, number][],
  k: number,
  iterations: number,
  rand: () => number,
): { assignment: number[]; centroids: [number, number][] } {
  let centroids = kMeansPlusPlusInit(pts, k, rand);
  let assignment = new Array(pts.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(pts[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
    }

    const sums: [number, number][] = Array.from({ length: k }, () => [0, 0]);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < pts.length; i++) {
      sums[assignment[i]][0] += pts[i][0];
      sums[assignment[i]][1] += pts[i][1];
      counts[assignment[i]]++;
    }
    centroids = centroids.map((c, idx) =>
      counts[idx] === 0
        ? c // keep an empty cluster where it is; rebalancing will feed it
        : ([sums[idx][0] / counts[idx], sums[idx][1] / counts[idx]] as [number, number]),
    );

    if (!moved) break;
  }

  return { assignment, centroids };
}

/**
 * Force near-equal cluster sizes.
 *
 * Points are assigned in descending order of regret — the gap between their
 * nearest and second-nearest centroid. A point that strongly prefers one cluster
 * gets first refusal; points that barely care absorb the imbalance. This is the
 * standard fix and it produces much better-looking routes than reassigning
 * arbitrary leftovers.
 */
function rebalance(
  pts: [number, number][],
  centroids: [number, number][],
  k: number,
): number[] {
  const n = pts.length;
  const cap = Math.ceil(n / k);

  const scored = pts.map((p, i) => {
    const dists = centroids.map((c) => sqDist(p, c));
    const order = dists
      .map((d, ci) => ({ d, ci }))
      .sort((a, b) => a.d - b.d);
    const regret = (order[1]?.d ?? order[0].d) - order[0].d;
    return { i, order, regret };
  });

  scored.sort((a, b) => b.regret - a.regret);

  const counts = new Array(k).fill(0);
  const assignment = new Array(n).fill(-1);

  for (const { i, order } of scored) {
    for (const { ci } of order) {
      if (counts[ci] < cap) {
        assignment[i] = ci;
        counts[ci]++;
        break;
      }
    }
    if (assignment[i] === -1) {
      // Only reachable through rounding; drop into the emptiest cluster.
      const ci = counts.indexOf(Math.min(...counts));
      assignment[i] = ci;
      counts[ci]++;
    }
  }

  return assignment;
}

function clusterStops(
  points: Point[],
  k: number,
  depot: { lat: number; lng: number },
  balanced: boolean,
): Point[][] {
  if (k <= 1 || points.length <= 1) return [points];
  if (points.length <= k) return points.map((p) => [p]);

  const projected = points.map((p) => project(p, depot));
  const rand = mulberry32(0x5eed);
  const { assignment, centroids } = lloyd(projected, k, 60, rand);
  const finalAssignment = balanced
    ? rebalance(projected, centroids, k)
    : assignment;

  const clusters: Point[][] = Array.from({ length: k }, () => []);
  finalAssignment.forEach((c, i) => clusters[c].push(points[i]));
  return clusters;
}

/* ---------------------------------------------------------------- sequencing */

/** Nearest neighbour from the depot over matrix indices. */
function nearestNeighbour(matrixIndices: number[], matrix: Matrix): number[] {
  const remaining = new Set(matrixIndices);
  const order: number[] = [];
  let current = DEPOT_INDEX;

  while (remaining.size > 0) {
    let best = -1;
    let bestCost = Infinity;
    for (const candidate of remaining) {
      const cost = matrix.distances[current][candidate];
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }
    order.push(best);
    remaining.delete(best);
    current = best;
  }
  return order;
}

/**
 * 2-opt: reverse a segment when it shortens the tour.
 *
 * The delta formula assumes a symmetric matrix. Road networks are near-symmetric
 * (one-way systems aside), so this holds well enough in practice. If asymmetry
 * ever matters — heavy one-way grids, ferries, toll direction — switch to Or-opt
 * only, which stays valid because it never reverses a segment.
 */
function twoOpt(
  order: number[],
  matrix: Matrix,
  roundTrip: boolean,
  maxPasses = 40,
): number[] {
  const d = matrix.distances;
  const route = [DEPOT_INDEX, ...order];
  if (roundTrip) route.push(DEPOT_INDEX);

  let improved = true;
  let passes = 0;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;
    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        const a = route[i - 1];
        const b = route[i];
        const c = route[j];
        const e = route[j + 1];
        const delta = d[a][c] + d[b][e] - (d[a][b] + d[c][e]);
        if (delta < -1e-9) {
          let lo = i;
          let hi = j;
          while (lo < hi) {
            [route[lo], route[hi]] = [route[hi], route[lo]];
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }

  return roundTrip ? route.slice(1, -1) : route.slice(1);
}

/**
 * Or-opt: relocate runs of 1–3 consecutive stops elsewhere in the tour.
 * Catches improvements 2-opt cannot, and is valid under asymmetry.
 */
function orOpt(
  order: number[],
  matrix: Matrix,
  roundTrip: boolean,
  maxPasses = 20,
): number[] {
  const d = matrix.distances;
  let best = [...order];

  const cost = (seq: number[]) => {
    const full = [DEPOT_INDEX, ...seq];
    if (roundTrip) full.push(DEPOT_INDEX);
    let total = 0;
    for (let i = 0; i < full.length - 1; i++) total += d[full[i]][full[i + 1]];
    return total;
  };

  let bestCost = cost(best);
  let improved = true;
  let passes = 0;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;
    for (let len = 1; len <= 3 && len <= best.length; len++) {
      for (let start = 0; start + len <= best.length; start++) {
        const segment = best.slice(start, start + len);
        const rest = [...best.slice(0, start), ...best.slice(start + len)];
        for (let pos = 0; pos <= rest.length; pos++) {
          if (pos === start) continue;
          const candidate = [...rest.slice(0, pos), ...segment, ...rest.slice(pos)];
          const c = cost(candidate);
          if (c < bestCost - 1e-9) {
            best = candidate;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
  }

  return best;
}

/* -------------------------------------------------------------------- solve */

export const greedySolver = {
  name: "greedy",
  label: "Fast",
  available: true,
  description:
    "Clusters stops geographically, then sequences each route with nearest neighbour and local improvement. Returns in under a second.",

  solve(problem: Problem, matrix: Matrix): Solution {
    const startedAt = Date.now();
    const warnings: string[] = [];

    const points: Point[] = problem.stops.map((s, index) => ({
      lat: s.lat,
      lng: s.lng,
      index,
    }));

    const vehicleCount = problem.vehicles.length;
    if (vehicleCount > points.length) {
      warnings.push(
        `Only ${points.length} stops for ${vehicleCount} vehicles. Some vehicles have no work.`,
      );
    }

    const clusters = clusterStops(
      points,
      vehicleCount,
      problem.depot,
      problem.options.objective === "balanced",
    );

    const orders: VehicleOrder[] = [];
    for (let v = 0; v < vehicleCount; v++) {
      const cluster = clusters[v] ?? [];
      if (cluster.length === 0) {
        orders.push([]);
        continue;
      }
      const matrixIndices = cluster.map((p) => matrixIndexForStop(p.index));
      let order = nearestNeighbour(matrixIndices, matrix);
      order = twoOpt(order, matrix, problem.options.roundTrip);
      order = orOpt(order, matrix, problem.options.roundTrip);
      orders.push(order);
    }

    // Leg arithmetic, totals and the baseline are shared with every other
    // engine so the comparison view is comparing routes, not implementations.
    return assembleSolution(problem, matrix, orders, {
      solver: "greedy",
      solveTimeMs: Date.now() - startedAt,
      warnings,
    });
  },
} satisfies Solver;

import { afterEach, describe, expect, it, vi } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "./schema";
import { buildMatrix, haversineMatrix } from "./matrix";

/**
 * The contract under test is "degrade, don't fail". OSRM is the one dependency
 * in the request path that is guaranteed to be down at some point, and a plan
 * with approximate distances beats an error page — provided the solution says
 * the distances are approximate.
 */

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function makeProblem(coords: { lat: number; lng: number }[]): Problem {
  return ProblemSchema.parse({
    depot: DEPOT,
    stops: coords.map((c, i) => ({ id: `s${i}`, ...c })),
    vehicles: expandVehicleCount(1),
  });
}

const NEARBY = [
  { lat: 48.86, lng: 2.35 },
  { lat: 48.87, lng: 2.36 },
  { lat: 48.85, lng: 2.34 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("haversine matrix", () => {
  it("is square, symmetric and zero on the diagonal", () => {
    const coords = [DEPOT, ...NEARBY];
    const m = haversineMatrix(coords);
    expect(m.size).toBe(4);
    expect(m.distances).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(m.distances[i]).toHaveLength(4);
      expect(m.distances[i][i]).toBe(0);
      expect(m.durations[i][i]).toBe(0);
      for (let j = 0; j < 4; j++) {
        expect(m.distances[i][j]).toBe(m.distances[j][i]);
      }
    }
  });

  it("labels itself as an estimate", () => {
    expect(haversineMatrix([DEPOT, ...NEARBY]).source).toBe("haversine");
  });

  it("puts the depot at index 0 and stops at 1..n", () => {
    const problem = makeProblem(NEARBY);
    const m = haversineMatrix([
      { lat: problem.depot.lat, lng: problem.depot.lng },
      ...problem.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ]);
    // Stop 2 is the closest to the depot of the three; if the ordering ever
    // slips, every leg distance in the manifest is attributed to the wrong stop.
    const fromDepot = [m.distances[0][1], m.distances[0][2], m.distances[0][3]];
    expect(fromDepot.indexOf(Math.min(...fromDepot))).toBe(0);
  });
});

describe("buildMatrix", () => {
  it("uses OSRM road distances when the service answers", async () => {
    const n = 4;
    const grid = (v: number) =>
      Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : v)),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "Ok", distances: grid(1000), durations: grid(120) }),
      ),
    );

    const { matrix, warnings } = await buildMatrix(makeProblem(NEARBY));
    expect(matrix.source).toBe("osrm");
    expect(matrix.distances[0][1]).toBe(1000);
    expect(matrix.durations[0][1]).toBe(120);
    expect(warnings).toEqual([]);
  });

  it("falls back to estimates and warns when OSRM is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    // Distinct coordinates so this misses the process-local cache.
    const { matrix, warnings } = await buildMatrix(
      makeProblem([{ lat: 48.9001, lng: 2.4001 }, { lat: 48.9102, lng: 2.4102 }]),
    );
    expect(matrix.source).toBe("haversine");
    expect(matrix.distances[0][1]).toBeGreaterThan(0);
    expect(warnings.join(" ")).toMatch(/straight-line/i);
  });

  it("falls back when OSRM answers with an error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "NoTable", message: "no table" }),
      ),
    );

    const { matrix, warnings } = await buildMatrix(
      makeProblem([{ lat: 48.9201, lng: 2.4201 }, { lat: 48.9302, lng: 2.4302 }]),
    );
    expect(matrix.source).toBe("haversine");
    expect(warnings).toHaveLength(1);
  });

  it("substitutes an estimate for a single unroutable pair", async () => {
    // A null cell means OSRM found no road between two points — an island, a
    // pedestrian zone, a bad geocode. One bad pair must not poison the matrix.
    const n = 3;
    const cell = (i: number, j: number) => (i === j ? 0 : 1000);
    const distances = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => cell(i, j)),
    ) as (number | null)[][];
    distances[0][2] = null;
    const durations = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : 120)),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "Ok", distances, durations })),
    );

    const { matrix } = await buildMatrix(
      makeProblem([{ lat: 48.9401, lng: 2.4401 }, { lat: 48.9502, lng: 2.4502 }]),
    );
    expect(matrix.source).toBe("osrm");
    expect(matrix.distances[0][2]).toBeGreaterThan(0);
    expect(Number.isFinite(matrix.distances[0][2])).toBe(true);
  });
});

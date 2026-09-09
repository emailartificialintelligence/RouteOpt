import { describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "./schema";
import { greedySolver, haversine } from "./solver/greedy";
import type { Matrix } from "./solver/types";
import type { DraftStop } from "./plan";
import {
  ROUTE_COLORS,
  defaultPlanOptions,
  draftToProblem,
  googleMapsLink,
  idleVehicles,
  manifestRows,
  routeColor,
  routePath,
} from "./routes";

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function stops(n: number): DraftStop[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    label: `Stop ${i}`,
    address: `${i} Test Road`,
    lat: DEPOT.lat + i * 0.004,
    lng: DEPOT.lng + i * 0.003,
    status: "located" as const,
  }));
}

function solved(stopCount: number, vehicleCount: number) {
  const problem: Problem = ProblemSchema.parse({
    depot: DEPOT,
    stops: stops(stopCount).map((s) => ({ id: s.id, label: s.label, lat: s.lat, lng: s.lng })),
    vehicles: expandVehicleCount(vehicleCount),
    options: { solver: "greedy" },
  });
  const coords = [DEPOT, ...problem.stops];
  const n = coords.length;
  const distances = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const durations = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(coords[i], coords[j]) * 1.3;
      distances[i][j] = distances[j][i] = d;
      durations[i][j] = durations[j][i] = d / 8.3;
    }
  }
  const matrix: Matrix = { distances, durations, source: "haversine", size: n };
  return { problem, solution: greedySolver.solve(problem, matrix) };
}

describe("routeColor", () => {
  it("gives each vehicle its own colour", () => {
    expect(routeColor(0)).toBe(ROUTE_COLORS[0]);
    expect(routeColor(3)).toBe(ROUTE_COLORS[3]);
  });

  it("wraps rather than running out", () => {
    // More vehicles than colours is legal; an undefined colour is not.
    expect(routeColor(ROUTE_COLORS.length)).toBe(ROUTE_COLORS[0]);
    expect(routeColor(99)).toBeTruthy();
  });
});

describe("draftToProblem", () => {
  it("builds a problem the schema accepts", () => {
    const problem = draftToProblem(DEPOT, stops(4), defaultPlanOptions);
    expect(problem).not.toBeNull();
    // The API is the only consumer, so passing its validator is the contract.
    expect(ProblemSchema.safeParse(problem).success).toBe(true);
  });

  it("expands a vehicle count into objects, never an integer", () => {
    const problem = draftToProblem(DEPOT, stops(4), {
      ...defaultPlanOptions,
      vehicleCount: 3,
    });
    expect(problem?.vehicles).toHaveLength(3);
    expect(new Set(problem?.vehicles.map((v) => v.id)).size).toBe(3);
  });

  it("drops stops that have no coordinates", () => {
    // Sending them as nulls would fail the whole request; the user has already
    // been told which stops are not ready.
    const withGap: DraftStop[] = [
      ...stops(2),
      { id: "bad", lat: null, lng: null, status: "failed" },
    ];
    const problem = draftToProblem(DEPOT, withGap, defaultPlanOptions);
    expect(problem?.stops).toHaveLength(2);
  });

  it("returns null with no depot", () => {
    expect(draftToProblem({ lat: null, lng: null }, stops(3), defaultPlanOptions)).toBeNull();
  });

  it("returns null when nothing is placed", () => {
    const none: DraftStop[] = [{ id: "a", lat: null, lng: null, status: "failed" }];
    expect(draftToProblem(DEPOT, none, defaultPlanOptions)).toBeNull();
  });

  it("carries the objective and round-trip choices through", () => {
    const problem = draftToProblem(DEPOT, stops(3), {
      ...defaultPlanOptions,
      objective: "distance",
      roundTrip: false,
    });
    expect(problem?.options.objective).toBe("distance");
    expect(problem?.options.roundTrip).toBe(false);
  });
});

describe("routePath", () => {
  it("runs depot, stops in sequence, depot", () => {
    const { problem, solution } = solved(6, 1);
    const path = routePath(problem, solution.routes[0]);
    const depot: [number, number] = [DEPOT.lng, DEPOT.lat];
    expect(path[0]).toEqual(depot);
    expect(path[path.length - 1]).toEqual(depot);
    expect(path).toHaveLength(solution.routes[0].stops.length + 2);
  });

  it("emits [lng, lat], the order maps and routers want", () => {
    const { problem, solution } = solved(3, 1);
    const [first] = routePath(problem, solution.routes[0]);
    // Latitude in the longitude slot is the bug that puts a route in the sea.
    expect(first[0]).toBeCloseTo(DEPOT.lng, 6);
    expect(first[1]).toBeCloseTo(DEPOT.lat, 6);
  });

  it("omits the return leg on an open route", () => {
    const { problem, solution } = solved(4, 1);
    const open = { ...problem, options: { ...problem.options, roundTrip: false } };
    const path = routePath(open, solution.routes[0]);
    expect(path).toHaveLength(solution.routes[0].stops.length + 1);
  });

  it("is just the depot for a vehicle with no work", () => {
    const { problem, solution } = solved(2, 4);
    const idle = solution.routes.find((r) => r.stops.length === 0);
    expect(idle).toBeDefined();
    expect(routePath(problem, idle!)).toHaveLength(1);
  });
});

describe("googleMapsLink", () => {
  it("builds a directions URL with origin, destination and waypoints", () => {
    const { problem, solution } = solved(5, 1);
    const link = googleMapsLink(routePath(problem, solution.routes[0]));
    expect(link).not.toBeNull();
    const url = new URL(link!.url);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.get("waypoints")).toBeTruthy();
  });

  it("writes coordinates as lat,lng, which is what Google expects", () => {
    const link = googleMapsLink([
      [2.3522, 48.8566],
      [2.3376, 48.8606],
    ]);
    const url = new URL(link!.url);
    expect(url.searchParams.get("origin")).toBe("48.8566,2.3522");
  });

  it("says so when a route is too long for one link", () => {
    // A truncated link a driver follows to the end, never reaching the last
    // stops, is worse than no link. The caller has to be able to warn.
    const path: [number, number][] = Array.from({ length: 40 }, (_, i) => [
      2.35 + i * 0.001,
      48.85 + i * 0.001,
    ]);
    const link = googleMapsLink(path);
    expect(link?.truncated).toBe(true);
    expect(link?.omitted).toBe(38 - 23);
  });

  it("does not truncate a route that fits", () => {
    const path: [number, number][] = Array.from({ length: 10 }, (_, i) => [
      2.35 + i * 0.001,
      48.85 + i * 0.001,
    ]);
    expect(googleMapsLink(path)?.truncated).toBe(false);
  });

  it("returns null for a route with nowhere to go", () => {
    expect(googleMapsLink([[2.35, 48.85]])).toBeNull();
    expect(googleMapsLink([])).toBeNull();
  });
});

describe("manifestRows", () => {
  it("numbers stops from one and names them for a human", () => {
    const { problem, solution } = solved(4, 1);
    const rows = manifestRows(problem, solution.routes[0]);
    expect(rows[0].sequence).toBe(1);
    // Never an internal id: "s3" means nothing in a van.
    expect(rows[0].name).toMatch(/^Stop /);
    expect(rows).toHaveLength(solution.routes[0].stops.length);
  });
});

describe("idleVehicles", () => {
  it("counts vehicles left with no work", () => {
    const { solution } = solved(2, 5);
    expect(idleVehicles(solution)).toBe(3);
  });

  it("is zero when everyone is busy", () => {
    const { solution } = solved(9, 3);
    expect(idleVehicles(solution)).toBe(0);
  });
});

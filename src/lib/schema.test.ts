import { describe, expect, it } from "vitest";
import {
  MAX_STOPS,
  ProblemSchema,
  SCHEMA_VERSION,
  expandVehicleCount,
  serviceTimeFor,
  toLngLat,
  type Options,
  type Stop,
} from "./schema";

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function stop(id: string, over: Partial<Stop> = {}): unknown {
  return { id, lat: DEPOT.lat, lng: DEPOT.lng, ...over };
}

describe("problem validation", () => {
  it("rejects a plan with no stops", () => {
    // The empty case is a user error with a fixable cause, not a solver input.
    // It has to fail at the schema so the route handler never reaches a matrix.
    const result = ProblemSchema.safeParse({
      depot: DEPOT,
      stops: [],
      vehicles: expandVehicleCount(1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plan with no vehicles", () => {
    const result = ProblemSchema.safeParse({
      depot: DEPOT,
      stops: [stop("s0")],
      vehicles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more stops than the matrix ceiling allows", () => {
    const stops = Array.from({ length: MAX_STOPS + 1 }, (_, i) => stop(`s${i}`));
    const result = ProblemSchema.safeParse({
      depot: DEPOT,
      stops,
      vehicles: expandVehicleCount(1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects coordinates outside the world", () => {
    const result = ProblemSchema.safeParse({
      depot: DEPOT,
      stops: [stop("s0", { lat: 91 })],
      vehicles: expandVehicleCount(1),
    });
    expect(result.success).toBe(false);
  });

  it("fills in defaults for a minimal problem", () => {
    const problem = ProblemSchema.parse({
      depot: DEPOT,
      stops: [stop("s0")],
      vehicles: expandVehicleCount(1),
    });
    expect(problem.version).toBe(SCHEMA_VERSION);
    expect(problem.options.objective).toBe("balanced");
    expect(problem.options.roundTrip).toBe(true);
    expect(problem.options.solver).toBe("greedy");
    // Reserved fields must materialise as null, not undefined: share links
    // round-trip through JSON, and undefined does not survive that.
    expect(problem.stops[0].demand).toBeNull();
    expect(problem.stops[0].timeWindow).toBeNull();
    expect(problem.vehicles[0].capacity).toBeNull();
  });

  it("rejects a time window that ends before it starts", () => {
    const result = ProblemSchema.safeParse({
      depot: DEPOT,
      stops: [stop("s0", { timeWindow: { earliest: 3600, latest: 60 } })],
      vehicles: expandVehicleCount(1),
    });
    expect(result.success).toBe(false);
  });
});

describe("helpers", () => {
  it("expands a vehicle count into distinct objects", () => {
    const vehicles = expandVehicleCount(3);
    expect(vehicles).toHaveLength(3);
    expect(new Set(vehicles.map((v) => v.id)).size).toBe(3);
    expect(vehicles.every((v) => v.profile === "driving")).toBe(true);
    // The output has to survive validation, or the UI's number input produces
    // a problem the API rejects.
    expect(
      ProblemSchema.safeParse({
        depot: DEPOT,
        stops: [stop("s0")],
        vehicles,
      }).success,
    ).toBe(true);
  });

  it("converts to lng,lat for map and routing clients", () => {
    expect(toLngLat({ lat: 48.8566, lng: 2.3522 })).toEqual([2.3522, 48.8566]);
  });

  it("prefers a stop's own service time over the default", () => {
    const options = { defaultServiceTime: 300 } as Options;
    expect(serviceTimeFor({ serviceTime: 900 } as Stop, options)).toBe(900);
    expect(serviceTimeFor({ serviceTime: null } as Stop, options)).toBe(300);
    // Zero is a real value a user can set, not a missing one.
    expect(serviceTimeFor({ serviceTime: 0 } as Stop, options)).toBe(0);
  });
});

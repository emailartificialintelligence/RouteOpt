import { z } from "zod";

/**
 * The wire contract.
 *
 * Share links encode this shape, so it is harder to change than any solver.
 * Rules:
 *   - Add optional fields freely.
 *   - Never rename or remove a field without bumping SCHEMA_VERSION and writing
 *     a migration in share.ts.
 *   - Fields marked "not used in v1" exist so that adding capacity, time windows
 *     or heterogeneous fleets later is not a breaking change.
 */
export const SCHEMA_VERSION = 1 as const;

/**
 * OSRM's table endpoint takes 100 *coordinates*, and the depot is one of them —
 * so 99 stops is the most that can get real road distances. Advertising 100
 * meant the top of the range silently fell back to straight-line estimates,
 * which is the one number a dispatcher must be able to trust.
 *
 * Raise this when you self-host OSRM and lift its table limit.
 */
export const MAX_STOPS = 99;

export const CoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coordinate = z.infer<typeof CoordinateSchema>;

/** Seconds since midnight, local to the operation. Not used in v1. */
export const TimeWindowSchema = z
  .object({ earliest: z.number().int().min(0), latest: z.number().int().min(0) })
  .refine((w) => w.latest >= w.earliest, {
    message: "Time window ends before it starts",
  });

export const StopSchema = z.object({
  id: z.string().min(1),
  /** What the driver sees on the manifest. Falls back to the address. */
  label: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Units of load consumed. Not used in v1. */
  demand: z.number().nonnegative().nullable().default(null),
  /** Not used in v1. */
  timeWindow: TimeWindowSchema.nullable().default(null),
  /** Seconds at the stop. Overrides options.defaultServiceTime when set. */
  serviceTime: z.number().int().nonnegative().nullable().default(null),
  /** Higher is more important. Reserved for optional-stop support. */
  priority: z.number().int().nullable().default(null),
});
export type Stop = z.infer<typeof StopSchema>;

/**
 * Always an array, even when the UI shows a single number input.
 * An integer count is the field that hurts most later: two vans and a bike is
 * the first thing a real operator asks for.
 */
export const VehicleSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** Not used in v1. */
  capacity: z.number().positive().nullable().default(null),
  /** Defaults to the depot when null. Not used in v1. */
  start: CoordinateSchema.nullable().default(null),
  end: CoordinateSchema.nullable().default(null),
  /** OSRM profile. Only "driving" is wired up in v1. */
  profile: z.enum(["driving", "cycling", "walking"]).default("driving"),
  /** Seconds. Not used in v1. */
  maxDuration: z.number().int().positive().nullable().default(null),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const ObjectiveSchema = z.enum([
  /** Minimize the sum of all route distances. Can leave one driver overloaded. */
  "distance",
  /** Minimize the longest single route. Everyone finishes around the same time. */
  "balanced",
]);
export type Objective = z.infer<typeof ObjectiveSchema>;

export const SolverNameSchema = z.enum(["greedy", "ortools", "pyvrp", "vroom"]);
export type SolverName = z.infer<typeof SolverNameSchema>;

export const OptionsSchema = z.object({
  objective: ObjectiveSchema.default("balanced"),
  /** False means each vehicle finishes at its last stop. */
  roundTrip: z.boolean().default(true),
  /** Seconds. The single number that most affects whether a plan survives. */
  defaultServiceTime: z.number().int().nonnegative().default(300),
  solver: SolverNameSchema.default("greedy"),
  /** Advisory. Greedy ignores it; later engines will not. */
  timeBudgetMs: z.number().int().positive().max(120_000).default(10_000),
});
export type Options = z.infer<typeof OptionsSchema>;

export const ProblemSchema = z.object({
  version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  depot: CoordinateSchema.extend({
    label: z.string().optional(),
    address: z.string().optional(),
  }),
  stops: z.array(StopSchema).min(1).max(MAX_STOPS),
  vehicles: z.array(VehicleSchema).min(1),
  options: OptionsSchema.default({}),
});
export type Problem = z.infer<typeof ProblemSchema>;

/* ---------------------------------------------------------------- solution */

export const RouteStopSchema = z.object({
  stopId: z.string(),
  /** Index into problem.stops. Saves the client a lookup. */
  stopIndex: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  /** Cumulative from the depot, including service time at prior stops. */
  arrivalOffset: z.number().int().nonnegative(),
  distanceFromPrevious: z.number().nonnegative(),
  durationFromPrevious: z.number().nonnegative(),
});
export type RouteStop = z.infer<typeof RouteStopSchema>;

export const RouteSchema = z.object({
  vehicleId: z.string(),
  vehicleLabel: z.string().optional(),
  /** Index into problem.vehicles; the UI uses it to pick a route color. */
  vehicleIndex: z.number().int().nonnegative(),
  stops: z.array(RouteStopSchema),
  totalDistance: z.number().nonnegative(),
  /** Travel plus service time, plus the return leg when roundTrip is true. */
  totalDuration: z.number().nonnegative(),
  totalLoad: z.number().nonnegative(),
});
export type Route = z.infer<typeof RouteSchema>;

export const SolutionSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  routes: z.array(RouteSchema),
  summary: z.object({
    totalDistance: z.number().nonnegative(),
    totalDuration: z.number().nonnegative(),
    longestRouteDistance: z.number().nonnegative(),
    vehiclesUsed: z.number().int().nonnegative(),
    stopsServed: z.number().int().nonnegative(),
    /** Cost of visiting stops in input order with one vehicle. Powers "down from X". */
    baselineDistance: z.number().nonnegative(),
  }),
  meta: z.object({
    solver: SolverNameSchema,
    solveTimeMs: z.number().nonnegative(),
    /** "haversine" means straight-line distances — the UI must say so. */
    matrixSource: z.enum(["osrm", "haversine"]),
    warnings: z.array(z.string()).default([]),
  }),
});
export type Solution = z.infer<typeof SolutionSchema>;

/* ----------------------------------------------------------------- helpers */

/** The UI collects a number; the schema needs objects. Convert here, once. */
export function expandVehicleCount(count: number): Vehicle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${i + 1}`,
    label: `Vehicle ${i + 1}`,
    capacity: null,
    start: null,
    end: null,
    profile: "driving" as const,
    maxDuration: null,
  }));
}

/** MapLibre and OSRM want [lng, lat]. Convert at the boundary, never inline. */
export function toLngLat(c: Coordinate): [number, number] {
  return [c.lng, c.lat];
}

export function serviceTimeFor(stop: Stop, options: Options): number {
  return stop.serviceTime ?? options.defaultServiceTime;
}

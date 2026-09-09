import type { Problem, Solution, SolverName } from "../schema";
import { SolverError, type Matrix, type Solver } from "./types";
import { assembleSolution, assertServesEveryStop, type VehicleOrder } from "./assemble";

/**
 * Engines that run in the sidecar process.
 *
 * OR-Tools, PyVRP and VROOM are all C++ libraries with Python bindings and no
 * usable JavaScript build, so they run beside the app (see sidecar/solver.py)
 * and this module speaks to them. One transport, one protocol, three engines:
 * they differ only in which solver the sidecar reaches for.
 *
 * That collides with the rule that solvers are pure and never touch the
 * network, so the collision is confined rather than spread: everything here is
 * a pure function except one injected transport. Request building, budget
 * arithmetic and response mapping — the parts that can actually be wrong — are
 * exported and tested without a process running. The Solver interface already
 * returns `Promise<Solution> | Solution`, which is what makes this fit at all.
 *
 * The sidecar returns only the assignment. Leg distances, arrival offsets and
 * totals are computed here by the same code the built-in engine uses, so the
 * comparison view compares routing rather than three implementations of
 * arithmetic.
 */

/** Which engine the sidecar should use. Sent on the wire. */
export type SidecarEngine = "ortools" | "pyvrp" | "vroom";

export interface SidecarRequest {
  engine: SidecarEngine;
  distances: number[][];
  durations: number[][];
  vehicleCount: number;
  roundTrip: boolean;
  objective: "distance" | "balanced";
  timeBudgetMs: number;
}

export interface SidecarResponse {
  /** One entry per vehicle: matrix indices in visit order, depot excluded. */
  routes: number[][];
  solveTimeMs: number;
}

/** How this module reaches the engine. Injected so the rest stays pure. */
export type SidecarTransport = (
  request: SidecarRequest,
  signal?: AbortSignal,
) => Promise<SidecarResponse>;

/**
 * How an engine spends the time it is given.
 *
 * These engines are anytime search: they find something quickly, then keep
 * trying to improve it until the clock runs out. None of them stops early on
 * having converged, so whatever budget arrives is spent in full, whether or not
 * the answer is still changing.
 *
 * Measured on the 12-stop example: budgets of 250ms, 500ms, 1s, 2s and 5s all
 * returned the identical plan. The last 4.75 seconds bought nothing and were
 * pure latency in front of a dispatcher.
 */
export interface BudgetPolicy {
  /**
   * Roughly how long a stop is worth searching. The search space grows far
   * faster than linearly, but the useful *search* time does not: past a point
   * the metaheuristic is refining a plan it will not meaningfully beat.
   */
  msPerStop: number;
  /** Below this, process startup dominates and there is nothing to gain. */
  floorMs: number;
}

/* ------------------------------------------------------------------- pure */

/**
 * What to actually ask the engine for.
 *
 * Never more than the caller asked for: `timeBudgetMs` is a ceiling the user
 * (or the API client) set, and this only ever spends less of it. That direction
 * matters — scaling *up* to a computed value would let a big problem quietly
 * exceed a budget someone chose deliberately, and blow through the platform's
 * request timeout with it.
 */
export function budgetForProblem(
  stopCount: number,
  requestedMs: number,
  policy: BudgetPolicy,
): number {
  const wanted = Math.max(policy.floorMs, stopCount * policy.msPerStop);
  return Math.max(1, Math.min(requestedMs, Math.round(wanted)));
}

export function buildSidecarRequest(
  problem: Problem,
  matrix: Matrix,
  engine: SidecarEngine,
  policy: BudgetPolicy,
): SidecarRequest {
  return {
    engine,
    distances: matrix.distances,
    durations: matrix.durations,
    vehicleCount: problem.vehicles.length,
    roundTrip: problem.options.roundTrip,
    objective: problem.options.objective,
    timeBudgetMs: budgetForProblem(
      problem.stops.length,
      problem.options.timeBudgetMs,
      policy,
    ),
  };
}

/**
 * Sidecar routes to vehicle orders.
 *
 * Pads to the vehicle count so a solver that returns fewer rows than there are
 * vehicles still yields a route per vehicle — an idle van has to appear in the
 * solution for "2 of 3 vans used" to be sayable.
 */
export function ordersFromResponse(
  response: SidecarResponse,
  vehicleCount: number,
): VehicleOrder[] {
  return Array.from(
    { length: vehicleCount },
    (_, v) => response.routes[v] ?? [],
  );
}

/* ------------------------------------------------------------------ engine */

export interface SidecarSolverConfig {
  name: SolverName;
  engine: SidecarEngine;
  label: string;
  description: string;
  budget: BudgetPolicy;
}

export function createSidecarSolver(
  config: SidecarSolverConfig,
  transport: SidecarTransport,
  available: boolean,
): Solver {
  return {
    name: config.name,
    label: config.label,
    available,
    description: config.description,

    async solve(problem: Problem, matrix: Matrix): Promise<Solution> {
      const startedAt = Date.now();
      const response = await transport(
        buildSidecarRequest(problem, matrix, config.engine, config.budget),
      );
      const orders = ordersFromResponse(response, problem.vehicles.length);

      /*
       * Check the assignment before believing it. A dropped stop produces a
       * plan that looks entirely plausible — shorter, even — and a delivery
       * that never happens; a repeated one sends two drivers to the same door.
       * Neither is visible on a map, and these engines are a separate process
       * in another language, so their output is not trusted on faith.
       */
      try {
        assertServesEveryStop(problem, orders);
      } catch {
        throw new SolverError(
          "INFEASIBLE",
          "The engine returned a plan that doesn't serve every stop. Try planning with Fast.",
        );
      }

      const warnings: string[] = [];
      if (problem.vehicles.length > problem.stops.length) {
        warnings.push(
          `Only ${problem.stops.length} stops for ${problem.vehicles.length} vehicles. Some vehicles have no work.`,
        );
      }

      return assembleSolution(problem, matrix, orders, {
        solver: config.name,
        // The sidecar's own measurement excludes transport; wall time is what
        // the user actually waited, and what the comparison table should show.
        solveTimeMs: Date.now() - startedAt,
        warnings,
      });
    },
  };
}

/* --------------------------------------------------------------- transport */

/**
 * The real transport. Reads its URL from the environment, which is why it lives
 * here and not inside the solver.
 */
export function httpTransport(
  baseUrl: string,
  timeoutMs: number,
  /**
   * Shared secret, when the sidecar is not on a private network.
   *
   * Hosted separately from the app it is reachable from the internet and will
   * spend seconds of CPU on any request it receives. Empty means the sidecar is
   * private and expects no token.
   */
  token = "",
  /** Named in error copy, so a failure says which engine to stop picking. */
  label = "This engine",
): SidecarTransport {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/solve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (res.status === 401) {
        // A wrong token is a deployment mistake, not something a user can fix
        // by retrying, so say which knob is wrong.
        throw new SolverError(
          "SOLVER_UNAVAILABLE",
          `The ${label} engine rejected our credentials. Check ORTOOLS_TOKEN matches on both sides.`,
        );
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        const code = body?.error?.code;
        if (code === "INFEASIBLE") {
          throw new SolverError(
            "INFEASIBLE",
            body?.error?.message ?? "No plan satisfies these constraints.",
          );
        }
        /*
         * The sidecar reports an engine it could not import separately from one
         * that is merely busy or broken. They need different copy: one is a
         * deployment that needs a rebuild, the other is worth retrying.
         */
        if (code === "ENGINE_UNAVAILABLE") {
          throw new SolverError(
            "SOLVER_UNAVAILABLE",
            body?.error?.message ??
              `${label} isn't installed in the solver service. Plan with Fast for now.`,
          );
        }
        throw new SolverError(
          "SOLVER_UNAVAILABLE",
          body?.error?.message ??
            `The ${label} engine isn't responding. Plan with Fast for now.`,
        );
      }

      return (await res.json()) as SidecarResponse;
    } catch (err) {
      if (err instanceof SolverError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new SolverError(
          "SOLVER_TIMEOUT",
          `The ${label} engine took too long. Try Fast, or fewer stops.`,
        );
      }
      throw new SolverError(
        "SOLVER_UNAVAILABLE",
        `Couldn't reach the ${label} engine. Plan with Fast for now.`,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

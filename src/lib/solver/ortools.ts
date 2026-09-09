import type { Problem, Solution } from "../schema";
import { SolverError, type Matrix, type Solver } from "./types";
import { assembleSolution, assertServesEveryStop, type VehicleOrder } from "./assemble";

/**
 * Google OR-Tools, via a sidecar process.
 *
 * OR-Tools is a C++ library with Python bindings and no usable JavaScript
 * build, so the engine itself runs beside the app (see sidecar/solver.py) and
 * this module speaks to it.
 *
 * That collides with the rule that solvers are pure and never touch the
 * network, so the collision is confined rather than spread: everything here is
 * a pure function except one injected transport. Request building and response
 * mapping — the parts that can actually be wrong — are exported and tested
 * without a process running. The Solver interface already returns
 * `Promise<Solution> | Solution`, which is what makes this fit at all.
 *
 * The sidecar returns only the assignment. Leg distances, arrival offsets and
 * totals are computed here by the same code the built-in engine uses, so the
 * comparison view compares routing rather than two implementations of
 * arithmetic.
 */

export interface SidecarRequest {
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

/* ------------------------------------------------------------------- pure */

export function buildSidecarRequest(
  problem: Problem,
  matrix: Matrix,
): SidecarRequest {
  return {
    distances: matrix.distances,
    durations: matrix.durations,
    vehicleCount: problem.vehicles.length,
    roundTrip: problem.options.roundTrip,
    objective: problem.options.objective,
    timeBudgetMs: problem.options.timeBudgetMs,
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

export function createOrToolsSolver(
  transport: SidecarTransport,
  available: boolean,
): Solver {
  return {
    name: "ortools",
    label: "Balanced",
    available,
    description:
      "Google OR-Tools with guided local search. Better routes, a few seconds of thinking.",

    async solve(problem: Problem, matrix: Matrix): Promise<Solution> {
      const startedAt = Date.now();
      const response = await transport(buildSidecarRequest(problem, matrix));
      const orders = ordersFromResponse(response, problem.vehicles.length);

      /*
       * Check the assignment before believing it. A dropped stop produces a
       * plan that looks entirely plausible — shorter, even — and a delivery
       * that never happens; a repeated one sends two drivers to the same door.
       * Neither is visible on a map, and this engine is a separate process in
       * another language, so its output is not trusted on faith.
       */
      try {
        assertServesEveryStop(problem, orders);
      } catch (err) {
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
        solver: "ortools",
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
          "The Balanced engine rejected our credentials. Check ORTOOLS_TOKEN matches on both sides.",
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
        throw new SolverError(
          "SOLVER_UNAVAILABLE",
          body?.error?.message ??
            "The Balanced engine isn't responding. Plan with Fast for now.",
        );
      }

      return (await res.json()) as SidecarResponse;
    } catch (err) {
      if (err instanceof SolverError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new SolverError(
          "SOLVER_TIMEOUT",
          "The Balanced engine took too long. Try Fast, or fewer stops.",
        );
      }
      throw new SolverError(
        "SOLVER_UNAVAILABLE",
        "Couldn't reach the Balanced engine. Plan with Fast for now.",
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

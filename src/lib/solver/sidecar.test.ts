import { describe, expect, it, vi } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "../schema";
import { haversine } from "./greedy";
import { SolverError, type Matrix } from "./types";
import {
  budgetForProblem,
  buildSidecarRequest,
  createSidecarSolver,
  ordersFromResponse,
  type BudgetPolicy,
  type SidecarResponse,
  type SidecarSolverConfig,
  type SidecarTransport,
} from "./sidecar";

/**
 * The engine runs in another process, in another language. These tests cover
 * the seam — what we send it, what we do with what comes back, and what happens
 * when it lies or disappears — without needing it running.
 */

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function problemOf(stopCount: number, vehicleCount: number, over = {}): Problem {
  return ProblemSchema.parse({
    depot: DEPOT,
    stops: Array.from({ length: stopCount }, (_, i) => ({
      id: `s${i}`,
      label: `Stop ${i}`,
      lat: DEPOT.lat + i * 0.004,
      lng: DEPOT.lng + i * 0.003,
    })),
    vehicles: expandVehicleCount(vehicleCount),
    options: { solver: "ortools", ...over },
  });
}

function matrixOf(problem: Problem): Matrix {
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
  return { distances, durations, source: "osrm", size: n };
}

const transportReturning = (response: SidecarResponse): SidecarTransport =>
  vi.fn(async () => response);

const POLICY: BudgetPolicy = { msPerStopSquared: 3, floorMs: 250 };

const ORTOOLS_CONFIG: SidecarSolverConfig = {
  name: "ortools",
  engine: "ortools",
  label: "Balanced",
  description: "Google OR-Tools with guided local search.",
  budget: POLICY,
};

/** The three engines share this code path; only the config differs. */
const createOrToolsSolver = (
  transport: SidecarTransport,
  available: boolean,
) => createSidecarSolver(ORTOOLS_CONFIG, transport, available);

const requestFor = (problem: Problem) =>
  buildSidecarRequest(problem, matrixOf(problem), "ortools", POLICY);

describe("buildSidecarRequest", () => {
  it("sends the matrix and the user's choices", () => {
    const problem = problemOf(4, 2, { objective: "distance", roundTrip: false });
    const request = requestFor(problem);
    expect(request.vehicleCount).toBe(2);
    expect(request.objective).toBe("distance");
    expect(request.roundTrip).toBe(false);
    expect(request.distances).toHaveLength(5);
  });

  it("names the engine, so one sidecar can serve all three", () => {
    const problem = problemOf(3, 1);
    expect(requestFor(problem).engine).toBe("ortools");
    expect(
      buildSidecarRequest(problem, matrixOf(problem), "pyvrp", POLICY).engine,
    ).toBe("pyvrp");
  });

  it("scales the time budget to the problem instead of spending all of it", () => {
    // These engines run until the clock stops rather than until they converge,
    // so a 3-stop plan handed 4.5s waits 4.5s for an answer it had in 250ms.
    const problem = problemOf(3, 1, { timeBudgetMs: 4500 });
    // 250ms floor + 3ms x 9 stops-squared.
    expect(requestFor(problem).timeBudgetMs).toBe(277);
  });
});

describe("budgetForProblem", () => {
  it("gives a big problem more time than a small one", () => {
    expect(budgetForProblem(90, 10_000, POLICY)).toBeGreaterThan(
      budgetForProblem(10, 10_000, POLICY),
    );
  });

  it("never exceeds what the caller asked for", () => {
    // The requested budget is a ceiling someone chose. Scaling *up* past it
    // would blow through the platform request timeout it was chosen to respect.
    expect(budgetForProblem(500, 2_000, POLICY)).toBe(2_000);
    expect(budgetForProblem(500, 100, POLICY)).toBe(100);
  });

  it("does not drop below the floor, where startup dominates", () => {
    expect(budgetForProblem(0, 10_000, POLICY)).toBe(POLICY.floorMs);
    expect(budgetForProblem(1, 10_000, POLICY)).toBeGreaterThanOrEqual(
      POLICY.floorMs,
    );
  });

  it("grows faster than linearly, because the search space does", () => {
    // A linear budget was the first attempt. It gave 40 stops 1.6s where they
    // were still improving at 5s, making the Balanced engine measurably worse
    // than it had been on exactly the size a real delivery round is.
    const small = budgetForProblem(10, 60_000, POLICY);
    const double = budgetForProblem(20, 60_000, POLICY);
    expect(double).toBeGreaterThan(small * 2);
  });

  it("reaches about five seconds at forty stops", () => {
    // The measured plateau for OR-Tools on a 40-stop round.
    const budget = budgetForProblem(40, 60_000, POLICY);
    expect(budget).toBeGreaterThan(4_000);
    expect(budget).toBeLessThan(6_000);
  });

  it("always asks for at least a millisecond", () => {
    // A zero budget is a solver that returns nothing at all.
    expect(budgetForProblem(10, 0, POLICY)).toBeGreaterThan(0);
  });
});

describe("ordersFromResponse", () => {
  it("keeps the sidecar's visit order", () => {
    const orders = ordersFromResponse({ routes: [[3, 1], [2]], solveTimeMs: 5 }, 2);
    expect(orders).toEqual([[3, 1], [2]]);
  });

  it("pads to the vehicle count so idle vans still appear", () => {
    // "2 of 3 vans used" can only be said if the third van is in the solution.
    expect(ordersFromResponse({ routes: [[1, 2]], solveTimeMs: 5 }, 3)).toEqual([
      [1, 2],
      [],
      [],
    ]);
  });
});

describe("createOrToolsSolver", () => {
  it("produces a solution with every stop served once", async () => {
    const problem = problemOf(5, 2);
    const solver = createOrToolsSolver(
      transportReturning({ routes: [[1, 2, 3], [4, 5]], solveTimeMs: 120 }),
      true,
    );
    const solution = await solver.solve(problem, matrixOf(problem));

    const served = solution.routes.flatMap((r) => r.stops.map((s) => s.stopId));
    expect(served).toHaveLength(5);
    expect(new Set(served).size).toBe(5);
    expect(solution.meta.solver).toBe("ortools");
  });

  it("computes totals the same way the built-in engine does", async () => {
    // The comparison view puts these numbers beside greedy's. A difference has
    // to mean different routing, not different arithmetic.
    const problem = problemOf(4, 1);
    const matrix = matrixOf(problem);
    const solver = createOrToolsSolver(
      transportReturning({ routes: [[1, 2, 3, 4]], solveTimeMs: 10 }),
      true,
    );
    const solution = await solver.solve(problem, matrix);

    let expected = 0;
    let cursor = 0;
    for (const m of [1, 2, 3, 4]) {
      expected += matrix.distances[cursor][m];
      cursor = m;
    }
    expected += matrix.distances[cursor][0]; // round trip
    expect(solution.routes[0].totalDistance).toBe(Math.round(expected));
  });

  it("rejects a plan that drops a stop", async () => {
    // A missing stop is a delivery that never happens, and it looks like a
    // perfectly good — even shorter — route on the map.
    const problem = problemOf(5, 2);
    const solver = createOrToolsSolver(
      transportReturning({ routes: [[1, 2], [3]], solveTimeMs: 9 }),
      true,
    );
    await expect(solver.solve(problem, matrixOf(problem))).rejects.toThrow(SolverError);
  });

  it("rejects a plan that visits a stop twice", async () => {
    const problem = problemOf(3, 2);
    const solver = createOrToolsSolver(
      transportReturning({ routes: [[1, 2], [2, 3]], solveTimeMs: 9 }),
      true,
    );
    await expect(solver.solve(problem, matrixOf(problem))).rejects.toThrow(
      /doesn't serve every stop/i,
    );
  });

  it("rejects a plan that routes through the depot as a stop", async () => {
    const problem = problemOf(3, 1);
    const solver = createOrToolsSolver(
      transportReturning({ routes: [[1, 0, 2, 3]], solveTimeMs: 9 }),
      true,
    );
    await expect(solver.solve(problem, matrixOf(problem))).rejects.toThrow(SolverError);
  });

  it("warns when there are more vehicles than stops", async () => {
    const problem = problemOf(2, 4);
    const solver = createOrToolsSolver(
      transportReturning({ routes: [[1], [2], [], []], solveTimeMs: 8 }),
      true,
    );
    const solution = await solver.solve(problem, matrixOf(problem));
    expect(solution.summary.vehiclesUsed).toBe(2);
    expect(solution.routes).toHaveLength(4);
    expect(solution.meta.warnings.join(" ")).toMatch(/no work/i);
  });

  it("reports wall time, not just the engine's own measurement", async () => {
    // What matters is how long the user waited, transport included.
    const problem = problemOf(3, 1);
    const solver = createOrToolsSolver(
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 40));
        return { routes: [[1, 2, 3]], solveTimeMs: 1 };
      }),
      true,
    );
    const solution = await solver.solve(problem, matrixOf(problem));
    expect(solution.meta.solveTimeMs).toBeGreaterThanOrEqual(35);
  });

  it("surfaces a transport failure as a solver error", async () => {
    const problem = problemOf(3, 1);
    const solver = createOrToolsSolver(async () => {
      throw new SolverError("SOLVER_UNAVAILABLE", "sidecar down");
    }, true);
    await expect(solver.solve(problem, matrixOf(problem))).rejects.toThrow(SolverError);
  });

  it("names the token when the sidecar rejects our credentials", async () => {
    // A wrong token is a deployment mistake, not something retrying fixes, so
    // the message has to say which knob is wrong.
    const problem = problemOf(3, 1);
    const solver = createOrToolsSolver(async () => {
      throw new SolverError(
        "SOLVER_UNAVAILABLE",
        "The Balanced engine rejected our credentials. Check ORTOOLS_TOKEN matches on both sides.",
      );
    }, true);
    await expect(solver.solve(problem, matrixOf(problem))).rejects.toThrow(
      /ORTOOLS_TOKEN/,
    );
  });

  it("is marked unavailable when no sidecar is configured", () => {
    const solver = createOrToolsSolver(transportReturning({ routes: [], solveTimeMs: 0 }), false);
    expect(solver.available).toBe(false);
    // Still carries copy: a dead control with no explanation reads as a bug.
    expect(solver.description.length).toBeGreaterThan(0);
    expect(solver.label).toBeTruthy();
  });
});

import type { SolverName } from "../schema";
import { greedySolver } from "./greedy";
import { createSidecarSolver, httpTransport, type BudgetPolicy } from "./sidecar";
import { SolverError, type Solver } from "./types";
import { envNumber, envString } from "../env";

/*
 * OR-Tools, PyVRP and VROOM all run in the same sidecar process
 * (sidecar/solver.py). They are only offered when one is configured: an engine
 * listed as available that then fails on every request is worse than one
 * honestly marked as not set up.
 *
 * SIDECAR_URL is the name that describes what this now is. ORTOOLS_URL is still
 * read because it is what is set in every existing deployment, and renaming an
 * environment variable that is already in production turns a feature addition
 * into an outage.
 */
const SIDECAR_URL = envString(
  process.env.SIDECAR_URL || process.env.ORTOOLS_URL,
  "",
);
const SIDECAR_TIMEOUT_MS = envNumber(
  process.env.SIDECAR_TIMEOUT_MS || process.env.ORTOOLS_TIMEOUT_MS,
  30_000,
);
/** Required when the sidecar is hosted separately rather than on a private network. */
const SIDECAR_TOKEN = envString(
  process.env.SIDECAR_TOKEN || process.env.ORTOOLS_TOKEN,
  "",
);

const configured = SIDECAR_URL !== "";

/**
 * How each engine spends its budget.
 *
 * All three are anytime search that runs until the clock stops, so the budget
 * is a latency decision, not a correctness one. They differ in what the extra
 * seconds are worth:
 *
 *   ortools  guided local search converges fast on problems this size and then
 *            polishes. Measured: a 12-stop plan was identical at 250ms and 5s.
 *   pyvrp    a genetic algorithm, and the one offered as "best quality". Time
 *            is the entire reason to pick it, so it gets the most.
 *   vroom    picked for being quick. Spending seconds in it defeats the point;
 *            its budget is mostly a safety net.
 */
const BUDGETS: Record<string, BudgetPolicy> = {
  ortools: { msPerStop: 40, floorMs: 250 },
  pyvrp: { msPerStop: 120, floorMs: 1_000 },
  vroom: { msPerStop: 20, floorMs: 250 },
};

const sidecarSolver = (
  name: SolverName & ("ortools" | "pyvrp" | "vroom"),
  label: string,
  description: string,
): Solver =>
  createSidecarSolver(
    { name, engine: name, label, description, budget: BUDGETS[name] },
    httpTransport(SIDECAR_URL, SIDECAR_TIMEOUT_MS, SIDECAR_TOKEN, label),
    configured,
  );

/**
 * Adding an engine is a file plus an entry here. Nothing else changes.
 *
 * The UI reads this registry to render the solver selector, so an engine that
 * is not switched on here still needs a label and a description. A disabled
 * control with no explanation reads as a bug; a disabled control that says what
 * it will be reads as a roadmap.
 */
export const solvers: Record<SolverName, Solver> = {
  greedy: greedySolver,

  ortools: sidecarSolver(
    "ortools",
    "Balanced",
    "Google OR-Tools with guided local search. Better routes, a few seconds of thinking.",
  ),

  pyvrp: sidecarSolver(
    "pyvrp",
    "Best quality",
    "Hybrid genetic search. The strongest routes available here, given a longer time budget.",
  ),

  vroom: sidecarSolver(
    "vroom",
    "VRoom",
    "Lightweight open-source engine. Fast on mid-sized problems.",
  ),
};

export function getSolver(name: SolverName): Solver {
  const solver = solvers[name];
  if (!solver) {
    throw new SolverError("UNKNOWN_SOLVER", `No engine named "${name}".`);
  }
  if (!solver.available) {
    // These engines are built but need a sidecar; say which, so an operator
    // knows whether this is "not written yet" or "not switched on here".
    throw new SolverError(
      "SOLVER_UNAVAILABLE",
      `${solver.label} needs the solver service. Set SIDECAR_URL, or plan with Fast.`,
    );
  }
  return solver;
}

/** Feeds the UI selector. */
export function listSolvers() {
  return Object.values(solvers).map(({ name, label, available, description }) => ({
    name,
    label,
    available,
    description,
  }));
}

export { SolverError };
export type { Solver, Matrix } from "./types";

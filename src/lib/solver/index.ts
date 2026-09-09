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
 *   ortools  guided local search. Twelve stops converge inside 250ms; forty
 *            were still improving at five seconds. Both are true, which is why
 *            the curve is quadratic rather than a single number.
 *   pyvrp    a genetic algorithm, and the one offered as "best quality". Time
 *            is the entire reason to pick it, so it gets the most.
 *   vroom    picked for being quick, and it takes no time budget at all — it
 *            runs an exploration level to completion. Its budget only bounds
 *            the cap search behind "even workload".
 */
const BUDGETS: Record<string, BudgetPolicy> = {
  // 3ms per stop squared: ~680ms at 12 stops, ~5s at 40, and past the caller's
  // ceiling by 60 — which is the shape the measurements have. Twelve stops
  // converge inside 250ms; forty were still improving at 5s.
  ortools: { msPerStopSquared: 3, floorMs: 250 },
  // The engine offered as "best quality". Time is the entire reason to pick it
  // over the other two, so it gets the most and starts from a higher floor.
  pyvrp: { msPerStopSquared: 5, floorMs: 1_000 },
  // Picked for being quick, and it does not take a time budget at all — it runs
  // an exploration level to completion. This only bounds the cap search it does
  // for "even workload", which is several solves rather than one.
  vroom: { msPerStopSquared: 1, floorMs: 250 },
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

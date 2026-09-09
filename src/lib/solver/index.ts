import type { SolverName } from "../schema";
import { greedySolver } from "./greedy";
import { createOrToolsSolver, httpTransport } from "./ortools";
import { SolverError, type Solver } from "./types";
import { envNumber, envString } from "../env";

/*
 * OR-Tools runs in a sidecar process (sidecar/solver.py). It is only offered
 * when one is configured: an engine listed as available that then fails on
 * every request is worse than one honestly marked as not set up.
 */
const ORTOOLS_URL = envString(process.env.ORTOOLS_URL, "");
const ORTOOLS_TIMEOUT_MS = envNumber(process.env.ORTOOLS_TIMEOUT_MS, 30_000);

/**
 * Adding an engine is a file plus an entry here. Nothing else changes.
 *
 * The unavailable entries are not dead code: the UI reads this registry to
 * render the solver selector, so a disabled engine still needs a label and a
 * description. A disabled control with no explanation reads as a bug; a disabled
 * control that says what it will be reads as a roadmap.
 */
const notImplemented =
  (name: SolverName, label: string, description: string): Solver => ({
    name,
    label,
    available: false,
    description,
    solve() {
      throw new SolverError(
        "SOLVER_UNAVAILABLE",
        `${label} isn't available yet. Plan with Fast for now.`,
      );
    },
  });

export const solvers: Record<SolverName, Solver> = {
  greedy: greedySolver,

  ortools: createOrToolsSolver(
    httpTransport(ORTOOLS_URL, ORTOOLS_TIMEOUT_MS),
    ORTOOLS_URL !== "",
  ),

  pyvrp: notImplemented(
    "pyvrp",
    "Best quality",
    "Hybrid genetic search. The strongest routes available here, given a longer time budget.",
  ),

  vroom: notImplemented(
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
    // OR-Tools is built but needs a sidecar; say which, so an operator knows
    // whether this is "not written yet" or "not switched on here".
    const reason =
      name === "ortools"
        ? `${solver.label} needs the OR-Tools sidecar. Set ORTOOLS_URL, or plan with Fast.`
        : `${solver.label} isn't available yet. Plan with Fast for now.`;
    throw new SolverError("SOLVER_UNAVAILABLE", reason);
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

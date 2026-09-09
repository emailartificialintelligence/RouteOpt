import type { Problem, Solution, SolverName } from "../schema";

/**
 * Square cost matrices over [depot, ...stops].
 * Index 0 is always the depot. Stop i in problem.stops is index i + 1.
 */
export interface Matrix {
  /** meters */
  distances: number[][];
  /** seconds */
  durations: number[][];
  source: "osrm" | "haversine";
  size: number;
}

/**
 * Every engine implements this. Solvers are pure: no fetching, no env vars,
 * no clock beyond measuring their own runtime. That is what makes them testable
 * and what makes the comparison view cheap to build later.
 */
export interface Solver {
  name: SolverName;
  /** Shown in the UI selector. */
  label: string;
  /** Disabled engines still appear in the selector with this note. */
  available: boolean;
  description: string;
  solve(problem: Problem, matrix: Matrix): Promise<Solution> | Solution;
}

export class SolverError extends Error {
  constructor(
    public code:
      | "UNKNOWN_SOLVER"
      | "SOLVER_UNAVAILABLE"
      | "SOLVER_TIMEOUT"
      | "INFEASIBLE",
    message: string,
  ) {
    super(message);
    this.name = "SolverError";
  }
}

export const DEPOT_INDEX = 0;

/** Stop i in problem.stops lives at matrix index i + 1. */
export const matrixIndexForStop = (stopIndex: number): number => stopIndex + 1;
export const stopIndexForMatrix = (matrixIndex: number): number => matrixIndex - 1;

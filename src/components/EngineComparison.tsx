"use client";

import { useCallback, useState } from "react";
import { ApiError, solveProblem, type SolverInfo } from "@/lib/api-client";
import { formatDistance, formatSolveTime, pluralise } from "@/lib/format";
import type { Problem, Solution } from "@/lib/schema";
import styles from "./Planner.module.css";

/**
 * The same problem, through every engine, in one table.
 *
 * This is the honest way to offer a choice of solver. Without it "Balanced" and
 * "Fast" are marketing words and the user has no way to know whether waiting
 * five seconds bought them anything. With it the trade is visible: on a typical
 * round OR-Tools finds materially shorter routes and takes a thousand times
 * longer to do it, and some days that is worth it and some days it is not.
 *
 * Each engine is run through the public solve endpoint, one request each — the
 * same call an external client would make.
 */

interface EngineComparisonProps {
  problem: Problem;
  solvers: SolverInfo[];
}

interface Row {
  name: string;
  label: string;
  status: "running" | "ok" | "failed";
  solution?: Solution;
  error?: string;
}

/** Lowest wins, ignoring engines that did not finish. */
function bestOf(rows: Row[], pick: (s: Solution) => number): number | null {
  const values = rows
    .filter((r) => r.solution)
    .map((r) => pick(r.solution as Solution));
  return values.length > 0 ? Math.min(...values) : null;
}

export function EngineComparison({ problem, solvers }: EngineComparisonProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);

  const available = solvers.filter((s) => s.available);

  const compare = useCallback(async () => {
    setRunning(true);
    setRows(available.map((s) => ({ name: s.name, label: s.label, status: "running" })));

    /*
     * Sequential, not parallel. A sidecar engine is CPU-bound and single
     * process; firing every engine at once would have them compete for the same
     * core and report solve times that say more about the contention than about
     * the engines.
     */
    for (const engine of available) {
      try {
        const solution = await solveProblem({
          ...problem,
          options: { ...problem.options, solver: engine.name as Problem["options"]["solver"] },
        });
        setRows((current) =>
          (current ?? []).map((r) =>
            r.name === engine.name ? { ...r, status: "ok", solution } : r,
          ),
        );
      } catch (err) {
        setRows((current) =>
          (current ?? []).map((r) =>
            r.name === engine.name
              ? {
                  ...r,
                  status: "failed",
                  error:
                    err instanceof ApiError
                      ? err.message
                      : "This engine didn't answer.",
                }
              : r,
          ),
        );
      }
    }
    setRunning(false);
  }, [problem, available]);

  if (available.length < 2 && !rows) {
    // One engine is not a comparison. Say why rather than showing a dead button.
    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Compare engines</h2>
        </div>
        <p className={styles.hint}>
          Only one engine is set up. Start the OR-Tools sidecar and set
          ORTOOLS_URL to compare against it.
        </p>
      </section>
    );
  }

  const bestTotal = rows ? bestOf(rows, (s) => s.summary.totalDistance) : null;
  const bestLongest = rows ? bestOf(rows, (s) => s.summary.longestRouteDistance) : null;
  const bestTime = rows ? bestOf(rows, (s) => s.meta.solveTimeMs) : null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Compare engines</h2>
        {rows && <span className={styles.count}>{pluralise(rows.length, "engine")}</span>}
      </div>

      <button
        type="button"
        className={styles.secondary}
        onClick={() => void compare()}
        disabled={running}
      >
        {running ? "Running…" : rows ? "Run again" : "Compare engines"}
      </button>

      {rows && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Engine</th>
              <th scope="col">Total</th>
              <th scope="col">Longest</th>
              <th scope="col">Vans</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.status !== "ok" || !row.solution) {
                return (
                  <tr key={row.name}>
                    <th scope="row">{row.label}</th>
                    <td colSpan={4} className={styles.tableNote}>
                      {row.status === "running" ? "Running…" : row.error}
                    </td>
                  </tr>
                );
              }
              const s = row.solution;
              const cell = (value: number, best: number | null) =>
                value === best ? styles.tableBest : undefined;

              return (
                <tr key={row.name}>
                  <th scope="row">{row.label}</th>
                  <td className={cell(s.summary.totalDistance, bestTotal)} data-numeric>
                    {formatDistance(s.summary.totalDistance)}
                  </td>
                  <td
                    className={cell(s.summary.longestRouteDistance, bestLongest)}
                    data-numeric
                  >
                    {formatDistance(s.summary.longestRouteDistance)}
                  </td>
                  <td data-numeric>{s.summary.vehiclesUsed}</td>
                  <td className={cell(s.meta.solveTimeMs, bestTime)} data-numeric>
                    {formatSolveTime(s.meta.solveTimeMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {rows && rows.some((r) => r.status === "ok") && (
        <p className={styles.hint}>
          Same stops, same vehicles, same objective. Best in each column is
          marked. Planning still uses the engine selected above.
        </p>
      )}
    </section>
  );
}

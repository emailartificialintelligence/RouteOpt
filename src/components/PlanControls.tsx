"use client";

import type { SolverInfo } from "@/lib/api-client";
import type { PlanOptions } from "@/lib/routes";
import styles from "./Planner.module.css";

/**
 * The three decisions a dispatcher actually makes before solving: how many
 * vans, what to optimise for, and whether they come back.
 *
 * Everything else the schema supports — capacities, time windows, per-vehicle
 * profiles — is deliberately absent. They exist in the wire format so adding
 * them later is not a breaking change, not so they can clutter the first screen
 * of a tool someone is using once, today.
 */

const MIN_VEHICLES = 1;
const MAX_VEHICLES = 8;

interface PlanControlsProps {
  options: PlanOptions;
  onChange: (next: PlanOptions) => void;
  solvers: SolverInfo[];
  stopCount: number;
  canSolve: boolean;
  blockingReasons: string[];
  solving: boolean;
  onSolve: () => void;
}

export function PlanControls({
  options,
  onChange,
  solvers,
  stopCount,
  canSolve,
  blockingReasons,
  solving,
  onSolve,
}: PlanControlsProps) {
  const set = <K extends keyof PlanOptions>(key: K, value: PlanOptions[K]) =>
    onChange({ ...options, [key]: value });

  // More vans than stops leaves someone idle; the solver warns, but saying it
  // here stops the user creating the problem in the first place.
  const tooManyVehicles = stopCount > 0 && options.vehicleCount > stopCount;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Plan</h2>
      </div>

      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>Vehicles</span>
        <div className={styles.stepper}>
          <button
            type="button"
            className={styles.stepperButton}
            onClick={() => set("vehicleCount", Math.max(MIN_VEHICLES, options.vehicleCount - 1))}
            disabled={options.vehicleCount <= MIN_VEHICLES}
            aria-label="One fewer vehicle"
          >
            −
          </button>
          <span className={styles.stepperValue} aria-live="polite">
            {options.vehicleCount}
          </span>
          <button
            type="button"
            className={styles.stepperButton}
            onClick={() => set("vehicleCount", Math.min(MAX_VEHICLES, options.vehicleCount + 1))}
            disabled={options.vehicleCount >= MAX_VEHICLES}
            aria-label="One more vehicle"
          >
            +
          </button>
        </div>
      </div>

      {tooManyVehicles && (
        <p className={styles.hint}>
          More vehicles than stops. Some will have no work.
        </p>
      )}

      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>Optimise for</span>
      </div>
      <div className={styles.segmented} role="group" aria-label="What to optimise for">
        <button
          type="button"
          className={options.objective === "balanced" ? styles.segmentActive : styles.segment}
          onClick={() => set("objective", "balanced")}
          aria-pressed={options.objective === "balanced"}
          title="Every driver finishes around the same time."
        >
          Even workload
        </button>
        <button
          type="button"
          className={options.objective === "distance" ? styles.segmentActive : styles.segment}
          onClick={() => set("objective", "distance")}
          aria-pressed={options.objective === "distance"}
          title="Fewest kilometres overall, even if one route is much longer."
        >
          Shortest total
        </button>
      </div>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={options.roundTrip}
          onChange={(e) => set("roundTrip", e.target.checked)}
        />
        <span className={styles.controlLabel}>Return to the depot</span>
      </label>

      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>Engine</span>
      </div>
      <select
        className={styles.select}
        value={options.solver}
        onChange={(e) => set("solver", e.target.value as PlanOptions["solver"])}
        aria-label="Solver engine"
      >
        {solvers.map((solver) => (
          <option
            key={solver.name}
            value={solver.name}
            disabled={!solver.available}
            /*
             * Disabled engines stay listed on purpose. A control that is greyed
             * out with no explanation reads as broken; one that says what it
             * will be reads as a roadmap.
             */
            title={
              solver.available
                ? solver.description
                : `Coming soon — ${solver.description}`
            }
          >
            {solver.label}
            {solver.available ? "" : " — coming soon"}
          </option>
        ))}
      </select>
      <p className={styles.hint}>
        {solvers.find((s) => s.name === options.solver)?.description}
      </p>

      <button
        type="button"
        className={styles.planButton}
        onClick={onSolve}
        disabled={!canSolve || solving}
      >
        {solving ? "Planning…" : "Plan routes"}
      </button>

      {!canSolve && blockingReasons.length > 0 && (
        <ul className={styles.blocking}>
          {blockingReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

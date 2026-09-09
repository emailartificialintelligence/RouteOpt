"use client";

import { useState } from "react";
import type { Problem, Solution } from "@/lib/schema";
import {
  formatArrival,
  formatDistance,
  formatDuration,
  formatSaving,
  pluralise,
} from "@/lib/format";
import {
  googleMapsLink,
  manifestRows,
  routeColor,
  routePath,
} from "@/lib/routes";
import styles from "./Planner.module.css";

/**
 * What came back from the solve.
 *
 * The claim this panel makes — "shorter than your list order" — is the product's
 * entire value proposition, so it is only ever shown when it is true. A plan
 * that did not beat the pasted order says nothing rather than inventing a
 * number, because a dispatcher who catches one false claim will not trust the
 * next one.
 */

interface RouteSummaryProps {
  problem: Problem;
  solution: Solution;
  onPrint: () => void;
}

export function RouteSummary({ problem, solution, onPrint }: RouteSummaryProps) {
  const [openVehicle, setOpenVehicle] = useState<string | null>(null);

  const { summary, meta } = solution;
  const saving = formatSaving(summary.totalDistance, summary.baselineDistance);
  const working = solution.routes.filter((r) => r.stops.length > 0);
  const idle = solution.routes.length - working.length;
  const approximate = meta.matrixSource === "haversine";

  return (
    <>
      <div className={styles.resultHead}>
        <h2 className={styles.resultTitle}>Routes planned.</h2>
        <div className={styles.headline} data-numeric>
          {formatDistance(summary.totalDistance)}
        </div>
        <p className={styles.headlineNote}>
          {saving ? (
            <>
              <span className={styles.saving}>{saving.text}</span>
              {" · "}
            </>
          ) : null}
          {pluralise(summary.stopsServed, "stop")} ·{" "}
          {pluralise(summary.vehiclesUsed, "van")} · longest{" "}
          {formatDistance(summary.longestRouteDistance)}
        </p>
      </div>

      {approximate && (
        <div className={styles.notice}>
          Distances are straight-line estimates — road distances were
          unavailable. Treat these as approximate.
        </div>
      )}

      {meta.warnings
        .filter((w) => !approximate || !/straight-line/i.test(w))
        .map((warning) => (
          <div key={warning} className={styles.notice}>
            {warning}
          </div>
        ))}

      {working.map((route) => {
        const color = routeColor(route.vehicleIndex);
        const open = openVehicle === route.vehicleId;
        const rows = manifestRows(problem, route);
        const link = googleMapsLink(routePath(problem, route));

        return (
          <div key={route.vehicleId} className={styles.vehicle}>
            <button
              type="button"
              className={styles.vehicleHead}
              onClick={() => setOpenVehicle(open ? null : route.vehicleId)}
              aria-expanded={open}
            >
              <span
                className={styles.swatch}
                style={{ background: color }}
                aria-hidden="true"
              />
              <span>
                <span className={styles.vehicleName}>
                  {route.vehicleLabel ?? `Van ${route.vehicleIndex + 1}`}
                </span>
                <span className={styles.vehicleMeta}>
                  {pluralise(route.stops.length, "stop")} ·{" "}
                  {formatDuration(route.totalDuration)}
                </span>
              </span>
              <span className={styles.vehicleDistance} data-numeric>
                {formatDistance(route.totalDistance)}
              </span>
            </button>

            {/*
              * Always in the DOM, hidden with CSS when collapsed.
              * Conditional rendering would mean the print stylesheet has
              * nothing to reveal, and printing would emit only whichever van
              * the user happened to have expanded — a manifest missing most of
              * the day's work, which is worse than no manifest at all.
              */}
            <ul
              className={
                open ? styles.manifest : `${styles.manifest} ${styles.manifestCollapsed}`
              }
            >
                {rows.map((row) => (
                  <li key={row.sequence} className={styles.manifestRow}>
                    <span className={styles.manifestIndex}>{row.sequence}</span>
                    <span>
                      {row.name}
                      <span className={styles.manifestLeg}>
                        {" · arrive "}
                        {formatArrival(row.arrivalOffset)}
                      </span>
                    </span>
                    <span className={styles.manifestLeg}>
                      {formatDistance(row.distanceFromPrevious)}
                    </span>
                  </li>
                ))}

                <li className={styles.manifestActions}>
                  {link && (
                    <a
                      className={styles.linkButton}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open in Google Maps
                    </a>
                  )}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={onPrint}
                  >
                    Print all routes
                  </button>
                </li>

                {link?.truncated && (
                  <li className={styles.stopNote}>
                    Google Maps takes 25 points per link, so the last{" "}
                    {pluralise(link.omitted, "stop")} {link.omitted === 1 ? "is" : "are"}{" "}
                    missing from it. Print the manifest for the full route.
                  </li>
                )}
            </ul>
          </div>
        );
      })}

      {idle > 0 && (
        <p className={styles.idle}>
          {pluralise(idle, "van")} {idle === 1 ? "has" : "have"} no stops.
          Plan with fewer vehicles to use everyone.
        </p>
      )}
    </>
  );
}

"use client";

import { useCallback, useState } from "react";
import {
  exportFilename,
  planToJson,
  routeToCsv,
  solutionToCsv,
} from "@/lib/export";
import { pluralise } from "@/lib/format";
import type { Problem, Solution } from "@/lib/schema";
import styles from "./Planner.module.css";

/**
 * Getting the plan out of the browser.
 *
 * There is no database, so this is not a convenience — it is the only way a
 * plan outlives the tab it was made in, apart from a share link. Four formats
 * because four different people need it: the office wants a spreadsheet, the
 * driver wants paper, and whatever the operation already runs on wants JSON.
 */

interface DownloadPanelProps {
  problem: Problem;
  solution: Solution;
  onPrint: () => void;
}

export function DownloadPanel({ problem, solution, onPrint }: DownloadPanelProps) {
  const [saved, setSaved] = useState<string | null>(null);

  /**
   * Save a string as a file.
   *
   * A blob URL leaks the whole file until the document unloads, so it is
   * revoked once the click has been dispatched — a dispatcher exporting twenty
   * plans in a session should not be holding twenty copies in memory.
   */
  const download = useCallback((contents: string, filename: string, mime: string) => {
    const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // A tick, so the browser has started reading before the URL goes away.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setSaved(filename);
    window.setTimeout(() => setSaved(null), 2500);
  }, []);

  const working = solution.routes.filter((r) => r.stops.length > 0);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Download</h2>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() =>
            download(
              solutionToCsv(problem, solution),
              exportFilename("all-routes", "csv"),
              "text/csv",
            )
          }
        >
          All routes (CSV)
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() =>
            download(
              planToJson(problem, solution),
              exportFilename("plan", "json"),
              "application/json",
            )
          }
        >
          Plan (JSON)
        </button>
        <button type="button" className={styles.secondary} onClick={onPrint}>
          Print or save as PDF
        </button>
      </div>

      <p className={styles.hint}>
        One file per driver, if that suits the round better:
      </p>
      <div className={styles.actions}>
        {working.map((route) => {
          const label = route.vehicleLabel ?? `Van ${route.vehicleIndex + 1}`;
          return (
            <button
              key={route.vehicleId}
              type="button"
              className={styles.secondary}
              onClick={() =>
                download(
                  routeToCsv(problem, route),
                  exportFilename(label, "csv"),
                  "text/csv",
                )
              }
              title={`${label} — ${pluralise(route.stops.length, "stop")}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Announced politely: a download gives no visible feedback of its own. */}
      <p className={styles.hint} role="status">
        {saved ? `Saved ${saved}` : "CSV opens in Excel or Sheets."}
      </p>
    </section>
  );
}

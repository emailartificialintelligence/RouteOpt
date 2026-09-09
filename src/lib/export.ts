import { formatArrival } from "./format";
import { manifestRows } from "./routes";
import type { Problem, Route, Solution } from "./schema";

/**
 * Getting a plan out of the browser and into a spreadsheet, a phone, or
 * whatever else the operation already runs on.
 *
 * All pure: these build strings. Turning a string into a file the browser saves
 * is the component's job.
 */

/**
 * One CSV field, escaped.
 *
 * Delivery labels are free text written by humans: "Smith, J.", `The "Old"
 * Mill`, and occasionally an address with a newline pasted out of an email.
 * Any of those shifts every subsequent column if it is not quoted, and a
 * manifest with the addresses one column to the left is worse than no manifest
 * — it looks correct.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

/*
 * CRLF and a byte-order mark, both for Excel.
 *
 * Without the BOM Excel reads UTF-8 as the local codepage, and every accented
 * street name in Europe arrives mangled. Without CRLF some versions treat the
 * whole file as one row. Neither matters to anything else that reads CSV.
 */
const CRLF = "\r\n";
const BOM = "﻿";

const HEADERS = [
  "Stop",
  "Name",
  "Address",
  "Latitude",
  "Longitude",
  "Arrival",
  "Leg km",
] as const;

function rowsFor(problem: Problem, route: Route, startHour: number) {
  return manifestRows(problem, route).map((row) => {
    const stop = problem.stops[route.stops[row.sequence - 1].stopIndex];
    return [
      row.sequence,
      row.name,
      stop?.address ?? "",
      stop?.lat.toFixed(6) ?? "",
      stop?.lng.toFixed(6) ?? "",
      formatArrival(row.arrivalOffset, startHour),
      (row.distanceFromPrevious / 1000).toFixed(2),
    ];
  });
}

/** One driver's round, ready to print or hand over. */
export function routeToCsv(
  problem: Problem,
  route: Route,
  startHour = 9,
): string {
  const lines = [csvRow([...HEADERS]), ...rowsFor(problem, route, startHour).map(csvRow)];
  return BOM + lines.join(CRLF) + CRLF;
}

/** Every route in one file, with a Vehicle column to split on. */
export function solutionToCsv(
  problem: Problem,
  solution: Solution,
  startHour = 9,
): string {
  const lines = [csvRow(["Vehicle", ...HEADERS])];
  for (const route of solution.routes) {
    if (route.stops.length === 0) continue;
    const label = route.vehicleLabel ?? `Van ${route.vehicleIndex + 1}`;
    for (const row of rowsFor(problem, route, startHour)) {
      lines.push(csvRow([label, ...row]));
    }
  }
  return BOM + lines.join(CRLF) + CRLF;
}

/**
 * The whole plan as JSON: the problem that was posted and the solution that
 * came back. Enough to re-solve it, diff it, or feed it to something else.
 */
export function planToJson(problem: Problem, solution: Solution): string {
  return JSON.stringify({ problem, solution }, null, 2);
}

/**
 * A filename that sorts chronologically and cannot break a filesystem.
 *
 * Vehicle labels reach this, and a label containing a slash would otherwise
 * write to a directory that does not exist.
 */
export function exportFilename(
  kind: string,
  extension: string,
  when = new Date(),
): string {
  const stamp = [
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, "0"),
    String(when.getDate()).padStart(2, "0"),
  ].join("-");
  const safe = kind
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `routeplan-${safe || "plan"}-${stamp}.${extension}`;
}

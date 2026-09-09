import { describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "./schema";
import { greedySolver, haversine } from "./solver/greedy";
import type { Matrix } from "./solver/types";
import {
  csvField,
  csvRow,
  exportFilename,
  planToJson,
  routeToCsv,
  solutionToCsv,
} from "./export";

/**
 * The escaping tests are the point of this file. A label containing a comma
 * shifts every column after it, and the result still opens in Excel and still
 * looks like a manifest — just with the addresses one column to the left. That
 * is worse than a file that fails to open.
 */

const DEPOT = { lat: 48.8443, lng: 2.3743 };

function solved(labels: string[]) {
  const problem: Problem = ProblemSchema.parse({
    depot: DEPOT,
    stops: labels.map((label, i) => ({
      id: `s${i}`,
      label,
      address: `${i} Rue de Test, Paris`,
      lat: DEPOT.lat + (i + 1) * 0.004,
      lng: DEPOT.lng + (i + 1) * 0.003,
    })),
    vehicles: expandVehicleCount(1),
    options: { solver: "greedy", defaultServiceTime: 300 },
  });
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
  const matrix: Matrix = { distances, durations, source: "osrm", size: n };
  return { problem, solution: greedySolver.solve(problem, matrix) };
}

describe("csvField", () => {
  it("leaves ordinary text alone", () => {
    expect(csvField("Acme Bakery")).toBe("Acme Bakery");
  });

  it("quotes a value containing a comma", () => {
    // "Smith, J." is an ordinary customer name and the commonest way a
    // manifest silently loses a column.
    expect(csvField("Smith, J.")).toBe('"Smith, J."');
  });

  it("doubles internal quotes", () => {
    expect(csvField('The "Old" Mill')).toBe('"The ""Old"" Mill"');
  });

  it("quotes a value containing a newline", () => {
    expect(csvField("Unit 4\nRear entrance")).toBe('"Unit 4\nRear entrance"');
  });

  it("renders null and undefined as empty, not as the word", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("keeps numbers unquoted", () => {
    expect(csvField(42)).toBe("42");
  });
});

describe("csvRow", () => {
  it("keeps the column count stable when a field contains a comma", () => {
    const row = csvRow(["1", "Smith, J.", "10 High St", "48.8", "2.3"]);
    // Naive splitting would find six fields; a real parser finds five.
    expect(row.split('","').length).toBeGreaterThan(0);
    expect(row).toBe('1,"Smith, J.",10 High St,48.8,2.3');
  });
});

describe("routeToCsv", () => {
  it("has a header and one row per stop", () => {
    const { problem, solution } = solved(["A", "B", "C"]);
    const lines = routeToCsv(problem, solution.routes[0]).trim().split("\r\n");
    expect(lines[0]).toMatch(/^﻿?Stop,Name,Address/);
    expect(lines).toHaveLength(4);
  });

  it("starts with a byte-order mark so Excel reads UTF-8", () => {
    // Without it every accented street name in Europe arrives mangled.
    const { problem, solution } = solved(["Café Beaubourg"]);
    expect(routeToCsv(problem, solution.routes[0]).startsWith("﻿")).toBe(true);
  });

  it("uses CRLF line endings", () => {
    const { problem, solution } = solved(["A", "B"]);
    expect(routeToCsv(problem, solution.routes[0])).toContain("\r\n");
  });

  it("survives labels full of punctuation", () => {
    const { problem, solution } = solved(['Smith, J.', 'The "Old" Mill']);
    const csv = routeToCsv(problem, solution.routes[0]);
    expect(csv).toContain('"Smith, J."');
    expect(csv).toContain('"The ""Old"" Mill"');
    // Every data row must still have exactly seven columns.
    for (const line of csv.trim().split("\r\n").slice(1)) {
      const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
      expect(fields.length).toBe(8); // 7 fields plus the trailing empty match
    }
  });

  it("writes coordinates at six decimals, not rounded to nothing", () => {
    const { problem, solution } = solved(["A"]);
    expect(routeToCsv(problem, solution.routes[0])).toMatch(/48\.\d{6}/);
  });

  it("writes clock arrival times a driver can read", () => {
    const { problem, solution } = solved(["A", "B"]);
    expect(routeToCsv(problem, solution.routes[0])).toMatch(/,\d{2}:\d{2},/);
  });
});

describe("solutionToCsv", () => {
  it("adds a vehicle column and skips idle vans", () => {
    const problem = ProblemSchema.parse({
      depot: DEPOT,
      stops: [
        { id: "a", label: "A", lat: 48.86, lng: 2.33 },
        { id: "b", label: "B", lat: 48.85, lng: 2.35 },
      ],
      vehicles: expandVehicleCount(4),
      options: { solver: "greedy" },
    });
    const n = 3;
    const flat = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : 1000)),
    );
    const solution = greedySolver.solve(problem, {
      distances: flat,
      durations: flat,
      source: "osrm",
      size: n,
    });
    const csv = solutionToCsv(problem, solution);
    expect(csv.split("\r\n")[0]).toMatch(/^﻿?Vehicle,Stop,Name/);
    // Two stops served; the two empty vans contribute no rows.
    expect(csv.trim().split("\r\n")).toHaveLength(3);
  });
});

describe("planToJson", () => {
  it("round-trips through JSON.parse", () => {
    const { problem, solution } = solved(["A", "B"]);
    const parsed = JSON.parse(planToJson(problem, solution));
    expect(parsed.problem.stops).toHaveLength(2);
    expect(parsed.solution.summary.stopsServed).toBe(2);
  });
});

describe("exportFilename", () => {
  const when = new Date(2026, 8, 9);

  it("sorts chronologically", () => {
    expect(exportFilename("all-routes", "csv", when)).toBe(
      "routeplan-all-routes-2026-09-09.csv",
    );
  });

  it("makes a vehicle label safe for a filesystem", () => {
    // A label with a slash would otherwise write into a directory that is not
    // there.
    expect(exportFilename("Van 1/2", "csv", when)).toBe(
      "routeplan-van-1-2-2026-09-09.csv",
    );
  });

  it("still produces a name when the label is all punctuation", () => {
    expect(exportFilename("///", "json", when)).toBe("routeplan-plan-2026-09-09.json");
  });
});

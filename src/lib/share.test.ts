import { describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "./schema";
import { greedySolver, haversine } from "./solver/greedy";
import type { Matrix } from "./solver/types";
import { ShareError, decodeShare, encodeShare, shareUrl } from "./share";

/**
 * The share link is the entire persistence layer in v1. A round-trip bug here
 * does not surface as an error at write time — it surfaces months later when
 * someone opens a link from a WhatsApp thread and gets nothing.
 */

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function makeProblem(stopCount: number, vehicleCount: number): Problem {
  const r = seeded(7);
  return ProblemSchema.parse({
    depot: { ...DEPOT, label: "Depot" },
    stops: Array.from({ length: stopCount }, (_, i) => ({
      id: `s${i}`,
      label: `Stop ${i}`,
      address: `${i} Rue de Test, Paris`,
      lat: DEPOT.lat + (r() - 0.5) * 0.08,
      lng: DEPOT.lng + (r() - 0.5) * 0.1,
    })),
    vehicles: expandVehicleCount(vehicleCount),
    options: { solver: "greedy" },
  });
}

function makeMatrix(problem: Problem): Matrix {
  const coords = [
    { lat: problem.depot.lat, lng: problem.depot.lng },
    ...problem.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
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
  return { distances, durations, source: "haversine", size: n };
}

function solved(stopCount: number, vehicleCount: number) {
  const problem = makeProblem(stopCount, vehicleCount);
  return { problem, solution: greedySolver.solve(problem, makeMatrix(problem)) };
}

describe("share encoding", () => {
  it("round-trips a plan without losing anything", () => {
    const { problem, solution } = solved(20, 3);
    const decoded = decodeShare(encodeShare(problem, solution));
    expect(decoded.problem).toEqual(problem);
    expect(decoded.solution).toEqual(solution);
  });

  it("stamps the payload version so old links stay readable", () => {
    const { problem, solution } = solved(5, 1);
    expect(encodeShare(problem, solution).startsWith("v1.")).toBe(true);
  });

  it("records when the plan was made", () => {
    const { problem, solution } = solved(5, 1);
    const before = Date.now();
    const decoded = decodeShare(encodeShare(problem, solution));
    expect(decoded.createdAt.getTime()).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000,
    );
  });

  it("produces a URL-safe token", () => {
    const { problem, solution } = solved(30, 4);
    const token = encodeShare(problem, solution);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("keeps a realistic 40-stop plan inside the link budget", () => {
    // The definition of done is 40 addresses and 3 vans. If that does not fit
    // in a URL, the share feature does not exist for the target user.
    const { problem, solution } = solved(40, 3);
    expect(encodeShare(problem, solution).length).toBeLessThan(8000);
  });

  it("rejects a link that was cut off in transit", () => {
    const { problem, solution } = solved(10, 2);
    const token = encodeShare(problem, solution);
    expect(() => decodeShare(token.slice(0, token.length - 40))).toThrow(
      ShareError,
    );
  });

  it("rejects a token with no version marker", () => {
    expect(() => decodeShare("notatoken")).toThrow(ShareError);
  });

  it("rejects a link from a future format", () => {
    const { problem, solution } = solved(5, 1);
    const token = encodeShare(problem, solution).replace(/^v1\./, "v2.");
    try {
      decodeShare(token);
      throw new Error("expected decodeShare to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ShareError);
      expect((err as ShareError).code).toBe("UNSUPPORTED_VERSION");
    }
  });

  it("builds a share URL without doubling the slash", () => {
    expect(shareUrl("https://example.com/", "v1.abc")).toBe(
      "https://example.com/r/v1.abc",
    );
    expect(shareUrl("https://example.com", "v1.abc")).toBe(
      "https://example.com/r/v1.abc",
    );
  });
});

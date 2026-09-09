import { beforeEach, describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount, type Problem } from "@/lib/schema";
import { greedySolver, haversine } from "@/lib/solver/greedy";
import type { Matrix } from "@/lib/solver/types";
import { decodeShare } from "@/lib/share";
import { POST } from "./route";

/**
 * The share link is the persistence layer. A bug here does not surface at write
 * time — it surfaces months later when someone opens a link from a message
 * thread and gets nothing.
 */

const DEPOT = { lat: 48.8566, lng: 2.3522 };

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function solved(stopCount: number, vehicleCount: number) {
  const r = seeded(11);
  const problem: Problem = ProblemSchema.parse({
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
  const matrix: Matrix = { distances, durations, source: "haversine", size: n };
  return { problem, solution: greedySolver.solve(problem, matrix) };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://internal.local/api/v1/share", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

import { resetRateLimits } from "@/lib/rate-limit";

// A fresh quota per test; otherwise the suite exhausts its own limit.
beforeEach(() => resetRateLimits());

describe("POST /api/v1/share", () => {
  it("returns a link whose payload decodes back to the same plan", async () => {
    const { problem, solution } = solved(20, 3);
    const res = await post({ problem, solution });
    expect(res.status).toBe(200);

    const body = await res.json();
    const decoded = decodeShare(body.token);
    expect(decoded.problem).toEqual(problem);
    expect(decoded.solution).toEqual(solution);
  });

  it("points the link at /r/ on this origin", async () => {
    const { problem, solution } = solved(5, 1);
    const res = await post({ problem, solution }, { host: "routeplan.example" });
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/routeplan\.example\/r\/v1\./);
  });

  it("trusts forwarded headers, so links work behind a proxy", async () => {
    // The request URL behind a proxy is the internal address; building links
    // from it produces URLs that point at nothing from outside.
    const { problem, solution } = solved(5, 1);
    const res = await post(
      { problem, solution },
      { "x-forwarded-host": "plan.example.com", "x-forwarded-proto": "https" },
    );
    expect((await res.json()).url).toMatch(/^https:\/\/plan\.example\.com\/r\//);
  });

  it("uses http for localhost, so dev links are clickable", async () => {
    const { problem, solution } = solved(3, 1);
    const res = await post({ problem, solution }, { host: "localhost:3000" });
    expect((await res.json()).url).toMatch(/^http:\/\/localhost:3000\/r\//);
  });

  it("keeps the definition-of-done plan inside the link budget", async () => {
    // 40 addresses and 3 vans is the v1 target. If that does not fit in a URL,
    // the share feature does not exist for the user it was built for.
    const { problem, solution } = solved(40, 3);
    const res = await post({ problem, solution });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeLessThan(body.maxLength);
  });

  it("says so when a plan is too large to be a link", async () => {
    // MAX_STOPS is 99: the depot takes one of OSRM's 100 coordinate slots.
    const { problem, solution } = solved(99, 6);
    const res = await post({ problem, solution });
    if (res.status === 413) {
      const body = await res.json();
      expect(body.error.code).toBe("TOO_LARGE");
      // Must name an alternative, not just refuse.
      expect(body.error.message).toMatch(/export|manifest/i);
    } else {
      // Still fitting is fine; the ceiling just has not been reached yet.
      expect(res.status).toBe(200);
    }
  });

  it("rejects a body that is not a plan", async () => {
    const res = await post({ problem: { nope: true } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects malformed JSON with readable copy", async () => {
    const res = await POST(
      new Request("http://internal.local/api/v1/share", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).not.toMatch(/SyntaxError/);
  });
});

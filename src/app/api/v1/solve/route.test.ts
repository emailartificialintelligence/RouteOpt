import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STOPS } from "@/lib/schema";
import { RATE_LIMITS, resetRateLimits } from "@/lib/rate-limit";
import { POST } from "./route";

/**
 * The route handler owns the error contract. These tests exist because the
 * codes in CLAUDE.md are a promise to API clients, and one of them was
 * unreachable: ProblemSchema caps stops at MAX_STOPS, so an oversized plan used
 * to fail as a generic INVALID_PROBLEM and TOO_MANY_STOPS could never fire.
 */

const DEPOT = { lat: 48.8443, lng: 2.3743 };

function stops(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    lat: 48.8 + i * 0.001,
    lng: 2.3 + i * 0.0007,
  }));
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/v1/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Keep these tests off the network; the matrix layer is tested separately. */
function stubOsrmDown() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline in tests");
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each test starts with a fresh quota; otherwise the suite exhausts it and
// later tests fail for a reason that has nothing to do with what they assert.
beforeEach(() => resetRateLimits());

describe("POST /api/v1/solve", () => {
  it("returns TOO_MANY_STOPS above the ceiling, not a generic validation error", async () => {
    const res = await post({
      depot: DEPOT,
      stops: stops(MAX_STOPS + 1),
      vehicles: [{ id: "v1" }],
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("TOO_MANY_STOPS");
    // The message has to name the number and the limit, or the user cannot act.
    expect(body.error.message).toContain(String(MAX_STOPS + 1));
    expect(body.error.message).toContain(String(MAX_STOPS));
  });

  it("accepts a plan exactly at the ceiling", async () => {
    stubOsrmDown();
    const res = await post({
      depot: DEPOT,
      stops: stops(MAX_STOPS),
      vehicles: [{ id: "v1" }, { id: "v2" }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.stopsServed).toBe(MAX_STOPS);
  });

  it("rejects malformed JSON with readable copy", async () => {
    const res = await POST(
      new Request("http://localhost/api/v1/solve", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PROBLEM");
    expect(body.error.message).not.toMatch(/JSON\.parse|SyntaxError|at position/);
  });

  it("reports which field was wrong", async () => {
    const res = await post({
      depot: DEPOT,
      stops: [{ id: "s1", lat: 91, lng: 2.3 }],
      vehicles: [{ id: "v1" }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_PROBLEM");
    expect(body.error.detail[0].path).toBe("stops.0.lat");
  });

  it("catches duplicate stop ids before they corrupt the manifest", async () => {
    const res = await post({
      depot: DEPOT,
      stops: [
        { id: "same", lat: 48.86, lng: 2.33 },
        { id: "same", lat: 48.85, lng: 2.35 },
      ],
      vehicles: [{ id: "v1" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/same id/i);
  });

  it("explains an engine that is not wired up yet", async () => {
    const res = await post({
      depot: DEPOT,
      stops: stops(3),
      vehicles: [{ id: "v1" }],
      options: { solver: "ortools" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("SOLVER_UNAVAILABLE");
  });

  it("degrades to estimates instead of failing when OSRM is down", async () => {
    stubOsrmDown();
    const res = await post({
      depot: DEPOT,
      stops: stops(6),
      vehicles: [{ id: "v1" }, { id: "v2" }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.matrixSource).toBe("haversine");
    // The UI can only warn about approximate distances if the API says so.
    expect(body.meta.warnings.length).toBeGreaterThan(0);
  });

  it("lists engines and objectives for the UI selector", async () => {
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.maxStops).toBe(MAX_STOPS);
    expect(body.solvers.find((s: { name: string }) => s.name === "greedy").available).toBe(true);
    // Disabled engines must still carry copy; a dead control with no
    // explanation reads as a bug.
    for (const s of body.solvers) expect(s.description.length).toBeGreaterThan(0);
  });
});

describe("rate limiting", () => {
  it("refuses a caller past the quota, with a Retry-After", async () => {
    // No auth in v1 means this is the only bound on cost.
    const body = { depot: DEPOT, stops: stops(3), vehicles: [{ id: "v1" }] };
    stubOsrmDown();

    for (let i = 0; i < RATE_LIMITS.solve.limit; i++) {
      const ok = await post(body);
      expect(ok.status).toBe(200);
    }

    const blocked = await post(body);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("tells a caller its remaining budget", async () => {
    stubOsrmDown();
    const res = await post({ depot: DEPOT, stops: stops(2), vehicles: [{ id: "v1" }] });
    expect(res.headers.get("RateLimit-Limit")).toBe(String(RATE_LIMITS.solve.limit));
  });
});

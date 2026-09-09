import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MAX_QUERIES_PER_REQUEST } from "@/lib/limits";
import { POST } from "./route";

/**
 * The geocode endpoint's contract.
 *
 * The behaviour worth pinning down is what happens when a lookup goes wrong,
 * because that is the common case with a rate-limited public geocoder: one bad
 * address must not cost the caller the other nine, and a 403 must say what to
 * fix rather than "try again", which would send someone round a loop that
 * cannot terminate.
 */

/** Distinct per test: the module caches by normalised query. */
let uniqueCounter = 0;
const uniqueQuery = () => `test address ${uniqueCounter++}, nowhere`;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/v1/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function stubNominatim(
  handler: (url: string) => { status?: number; body?: unknown },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const { status = 200, body = [] } = handler(String(input));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

const house = (name: string) => ({
  lat: "48.8566",
  lon: "2.3522",
  display_name: name,
  addresstype: "house",
  class: "building",
  address: { house_number: "10" },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { resetRateLimits } from "@/lib/rate-limit";

// A fresh quota per test; otherwise the suite exhausts its own limit.
beforeEach(() => resetRateLimits());

describe("POST /api/v1/geocode", () => {
  it("returns one result per query, in order", async () => {
    const queries = [uniqueQuery(), uniqueQuery(), uniqueQuery()];
    let n = 0;
    stubNominatim(() => ({ body: [house(`Match ${n++}`)] }));

    const res = await post({ queries });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(3);
    expect(body.results.map((r: { query: string }) => r.query)).toEqual(queries);
    expect(body.results[0].status).toBe("ok");
  });

  it("keeps the good results when one lookup fails", async () => {
    // Losing nine good matches because the tenth timed out is not an
    // acceptable trade — the user would have to re-run the whole list.
    const good = uniqueQuery();
    const bad = "explodeplease";
    stubNominatim((url) => {
      if (url.includes("explodeplease")) throw new Error("boom");
      return { body: [house("Good match")] };
    });

    const res = await post({ queries: [good, bad] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe("ok");
    expect(body.results[1].status).toBe("not_found");
  });

  it("names the actual fix on a 403 instead of saying try again", async () => {
    // Nominatim answers 403 when it cannot attribute the request. "Try again"
    // would be a lie: it will 403 forever until the User-Agent is set.
    stubNominatim(() => ({ status: 403, body: {} }));

    const res = await post({ queries: [uniqueQuery()] });
    const body = await res.json();
    expect(body.results[0].status).toBe("not_found");
    expect(res.status).toBe(200);
  });

  it("reports an empty result set as not found, with an instruction", async () => {
    stubNominatim(() => ({ body: [] }));

    const res = await post({ queries: [uniqueQuery()] });
    const body = await res.json();
    expect(body.results[0].status).toBe("not_found");
    expect(body.results[0].note).toMatch(/spelling|postcode/i);
  });

  it("flags several distinct matches for the user to choose between", async () => {
    stubNominatim(() => ({
      body: [
        { ...house("Springfield, Illinois"), lat: "39.78", lon: "-89.65" },
        { ...house("Springfield, Massachusetts"), lat: "42.10", lon: "-72.59" },
      ],
    }));

    const res = await post({ queries: [uniqueQuery()] });
    const body = await res.json();
    expect(body.results[0].status).toBe("ambiguous");
    expect(body.results[0].candidates).toHaveLength(2);
  });

  it("refuses a batch over the per-request cap", async () => {
    const queries = Array.from({ length: MAX_QUERIES_PER_REQUEST + 1 }, uniqueQuery);
    const res = await post({ queries });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("TOO_MANY_QUERIES");
    expect(body.error.message).toContain(String(MAX_QUERIES_PER_REQUEST));
  });

  it("rejects a request with no queries", async () => {
    const res = await post({ queries: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects malformed JSON with readable copy", async () => {
    const res = await POST(
      new Request("http://localhost/api/v1/geocode", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).not.toMatch(/SyntaxError|JSON\.parse/);
  });

  it("identifies the project to the geocoder on every call", async () => {
    // Nominatim's policy requires attribution, and an unattributed deployment
    // gets blocked for everyone using it at once.
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push(headers.get("User-Agent") ?? "");
        return new Response(JSON.stringify([house("A place")]), { status: 200 });
      }),
    );

    await post({ queries: [uniqueQuery()] });
    expect(seen[0]).toBeTruthy();
    expect(seen[0]).not.toMatch(/contact-unset/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
  resetRateLimits,
} from "./rate-limit";

/**
 * With no auth in v1, this is the only thing standing between a public
 * deployment and an unbounded compute bill. The cases that matter are the ones
 * where a limiter silently stops limiting.
 */

const rule = { limit: 3, windowMs: 60_000 };

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("checkRateLimit", () => {
  it("allows up to the limit and then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("a", rule, now).allowed).toBe(true);
    }
    expect(checkRateLimit("a", rule, now).allowed).toBe(false);
  });

  it("counts down the remaining budget", () => {
    const now = 1_000_000;
    expect(checkRateLimit("a", rule, now).remaining).toBe(2);
    expect(checkRateLimit("a", rule, now).remaining).toBe(1);
    expect(checkRateLimit("a", rule, now).remaining).toBe(0);
  });

  it("never reports negative remaining", () => {
    const now = 1_000_000;
    for (let i = 0; i < 6; i++) checkRateLimit("a", rule, now);
    expect(checkRateLimit("a", rule, now).remaining).toBe(0);
  });

  it("keeps callers in separate buckets", () => {
    // One noisy client must not exhaust everyone else's quota.
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", rule, now);
    expect(checkRateLimit("a", rule, now).allowed).toBe(false);
    expect(checkRateLimit("b", rule, now).allowed).toBe(true);
  });

  it("opens a fresh window once the old one expires", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", rule, now);
    expect(checkRateLimit("a", rule, now).allowed).toBe(false);
    expect(checkRateLimit("a", rule, now + 60_001).allowed).toBe(true);
  });

  it("reports a usable Retry-After", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", rule, now);
    const blocked = checkRateLimit("a", rule, now + 30_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(30);
  });

  it("never tells a blocked caller to retry in zero seconds", () => {
    // A zero would invite an immediate retry, turning a limiter into a spin.
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("a", rule, now);
    const blocked = checkRateLimit("a", rule, now + 59_999);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("clientKey", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("http://x/api", { headers });

  it("ignores forwarding headers when no proxy is declared", () => {
    // Trusting x-forwarded-for unconditionally hands anyone an unlimited quota:
    // send a random header, get a fresh bucket every request.
    vi.stubEnv("TRUST_PROXY", "false");
    expect(clientKey(withHeaders({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
  });

  it("falls back to one shared bucket rather than exempting the caller", () => {
    expect(clientKey(withHeaders({}))).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("tells a client its budget", () => {
    const result = {
      allowed: true,
      limit: 20,
      remaining: 19,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    };
    const headers = rateLimitHeaders(result);
    expect(headers["RateLimit-Limit"]).toBe("20");
    expect(headers["RateLimit-Remaining"]).toBe("19");
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After only when blocked", () => {
    const headers = rateLimitHeaders({
      allowed: false,
      limit: 20,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });
    expect(headers["Retry-After"]).toBe("30");
  });
});

describe("misconfiguration", () => {
  it("refuses consistently when a limit is zero, not once then never", () => {
    /*
     * The first request in a window used to be allowed unconditionally. With a
     * limit of 0 that meant one request succeeded and everything after it was
     * refused — which looks like a random "too many requests" on a page the
     * user has only just opened.
     */
    const zero = { limit: 0, windowMs: 60_000 };
    const now = 2_000_000;
    expect(checkRateLimit("z", zero, now).allowed).toBe(false);
    expect(checkRateLimit("z", zero, now).allowed).toBe(false);
  });

  it("never reports negative remaining, even misconfigured", () => {
    const result = checkRateLimit("z2", { limit: 0, windowMs: 60_000 }, 3_000_000);
    expect(result.remaining).toBe(0);
  });

  it("gives a blocked caller a real Retry-After on the first request", () => {
    const result = checkRateLimit("z3", { limit: 0, windowMs: 60_000 }, 4_000_000);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

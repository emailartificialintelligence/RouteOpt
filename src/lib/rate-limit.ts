/**
 * IP-keyed rate limiting.
 *
 * There is no auth in v1 by design — the whole product is "get a route without
 * making an account" — which means the only thing between a public deployment
 * and someone's compute bill is this file. A solve builds an N+1 squared
 * distance matrix and can occupy a CPU for seconds; geocoding is throttled to
 * one request per second upstream, so a handful of clients can starve everyone
 * else.
 *
 * A fixed window, not a token bucket: it is easier to reason about when reading
 * logs at 3am, and the burst it permits at a window boundary is irrelevant at
 * these limits.
 *
 * State is process-local. That is correct for a single instance and wrong the
 * moment you run two, because each replica would then allow the full quota —
 * move this to Redis before scaling out. It is deliberately a small, explicit
 * seam rather than a dependency, so that swap is a rewrite of one file.
 *
 * On serverless (Vercel), that caveat is not hypothetical: each cold instance
 * starts with an empty map, so this is best-effort — it will stop a naive loop
 * hitting one warm instance and will not stop a distributed one. Use the
 * platform's own edge rate limiting as the real boundary there, and treat this
 * as defence in depth. See VERCEL.md.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the current window ends. */
  resetAt: number;
  /** Seconds to wait, for a Retry-After header. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Bound the map so a flood of distinct keys cannot exhaust memory — which would
 * turn a rate limiter into the outage it exists to prevent.
 */
const MAX_TRACKED_KEYS = 20_000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size <= MAX_TRACKED_KEYS) return;
  // Still too many live windows: drop the oldest. Under this much pressure,
  // under-counting a few callers beats falling over.
  const excess = windows.size - MAX_TRACKED_KEYS;
  let dropped = 0;
  for (const key of windows.keys()) {
    windows.delete(key);
    if (++dropped >= excess) break;
  }
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitResult {
  if (windows.size > MAX_TRACKED_KEYS / 2) sweep(now);

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    windows.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;

  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Tests need a clean slate; nothing else should call this. */
export function resetRateLimits(): void {
  windows.clear();
}

/* ------------------------------------------------------------ client keys */

/**
 * Whether to believe forwarding headers.
 *
 * `x-forwarded-for` is trivially spoofed by a direct client, so trusting it
 * unconditionally hands anyone an unlimited quota by sending a random header.
 * Trust it only when the deployment says there really is a proxy in front.
 */
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

/**
 * Identify the caller.
 *
 * Falls back to a single shared bucket when no address can be determined, which
 * throttles anonymous traffic as a group rather than silently exempting it.
 */
export function clientKey(request: Request): string {
  if (TRUST_PROXY) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      // Left-most entry is the original client; the rest are proxies.
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = request.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "unknown";
}

/* --------------------------------------------------------------- policies */

const seconds = (n: number) => n * 1000;

/**
 * Limits are per IP per minute, set to be invisible to a dispatcher planning a
 * round and obstructive to a script.
 */
export const RATE_LIMITS = {
  /** Builds a matrix and runs a solver. The expensive one. */
  solve: { limit: Number(process.env.RATE_LIMIT_SOLVE ?? 20), windowMs: seconds(60) },
  /** Throttled to 1/sec upstream anyway; this stops one client monopolising it. */
  geocode: { limit: Number(process.env.RATE_LIMIT_GEOCODE ?? 60), windowMs: seconds(60) },
  /** Cheap, but it is a third-party call we are paying for. */
  geometry: { limit: Number(process.env.RATE_LIMIT_GEOMETRY ?? 60), windowMs: seconds(60) },
  /** Pure computation, no third party. Generous. */
  share: { limit: Number(process.env.RATE_LIMIT_SHARE ?? 60), windowMs: seconds(60) },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitHeaders {
  [key: string]: string;
}

/** Standard-ish headers so a client can back off politely rather than guess. */
export function rateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}

import { NextResponse } from "next/server";
import {
  RATE_LIMITS,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { z } from "zod";
import {
  GeocodeError,
  MAX_QUERIES_PER_REQUEST,
  geocodeBatch,
} from "@/lib/geocode";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Address lookup, batched.
 *
 * This is a server route rather than a browser fetch for three reasons that all
 * matter: Nominatim's policy requires a contact address in the User-Agent that
 * a browser cannot set, the one-request-per-second limit has to be enforced
 * process-wide rather than per tab, and results cache across users. Calling the
 * geocoder from the client would get the deployment blocked within a day.
 *
 * Batches are small on purpose. Ten addresses at one request per second is ten
 * seconds; the client sends several small batches so the map can fill in as it
 * goes, instead of one long request that looks frozen.
 */

const RequestSchema = z.object({
  queries: z.array(z.string()).min(1).max(MAX_QUERIES_PER_REQUEST),
});

type ErrorCode =
  | "INVALID_REQUEST"
  | "GEOCODE_FAILED"
  | "GEOCODE_RATE_LIMITED"
  | "TOO_MANY_QUERIES"
  | "INTERNAL";

function fail(code: ErrorCode, message: string, status: number, detail?: unknown) {
  return NextResponse.json({ error: { code, message, detail } }, { status });
}

export async function POST(request: Request) {
  /*
   * No auth in v1 by design, so this is the only thing bounding cost. Checked
   * before the body is even read: a blocked caller should be cheap to refuse.
   */
  const limit = checkRateLimit(clientKey(request), RATE_LIMITS.geocode);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Wait ${limit.retryAfterSeconds}s and try again.`,
        },
      },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_REQUEST", "The request body isn't valid JSON.", 400);
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const tooMany =
      typeof raw === "object" &&
      raw !== null &&
      Array.isArray((raw as { queries?: unknown }).queries) &&
      (raw as { queries: unknown[] }).queries.length > MAX_QUERIES_PER_REQUEST;

    if (tooMany) {
      return fail(
        "TOO_MANY_QUERIES",
        `Look up at most ${MAX_QUERIES_PER_REQUEST} addresses at a time.`,
        400,
      );
    }
    return fail(
      "INVALID_REQUEST",
      "Send a list of addresses to look up.",
      400,
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }

  try {
    const results = await geocodeBatch(parsed.data.queries);
    return NextResponse.json(
      { results },
      // Lookups are cached server-side; the browser holding a stale copy of a
      // corrected address would be worse than the round trip. The budget goes
      // on every response so a client can slow down before it is refused.
      { headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof GeocodeError) {
      const status = err.code === "GEOCODE_RATE_LIMITED" ? 429 : 400;
      return fail(err.code, err.message, status);
    }
    console.error("[geocode] unexpected failure:", err);
    return fail(
      "INTERNAL",
      "Something went wrong looking up addresses. Try again in a moment.",
      500,
    );
  }
}

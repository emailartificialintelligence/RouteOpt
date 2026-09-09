import { NextResponse } from "next/server";
import {
  RATE_LIMITS,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { z } from "zod";
import {
  GeometryError,
  MAX_GEOMETRY_COORDINATES,
  fetchRouteGeometry,
  type LngLat,
} from "@/lib/geometry";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Road shapes for drawing solved routes.
 *
 * Deliberately separate from /solve: the plan does not depend on this, and a
 * failure here must not cost anyone their routes. The client draws straight
 * lines between stops when this is unavailable — an uglier map, the same plan.
 *
 * One request carries every vehicle's path so a six-van plan is one round trip
 * rather than six.
 */

const CoordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const RequestSchema = z.object({
  /** One path per vehicle, each an ordered list of [lng, lat]. */
  paths: z.array(z.array(CoordinateSchema)).min(1).max(16),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  /*
   * No auth in v1 by design, so this is the only thing bounding cost. Checked
   * before the body is even read: a blocked caller should be cheap to refuse.
   */
  const limit = checkRateLimit(clientKey(request), RATE_LIMITS.geometry);
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
    return fail(
      "INVALID_REQUEST",
      "Send one list of [lng, lat] points per route.",
      400,
    );
  }

  /*
   * Settle every path rather than failing the batch on the first error. One
   * van's shape being unavailable is not a reason to draw none of them, so a
   * failed path comes back as null and the client falls back for that route
   * alone.
   */
  const results = await Promise.all(
    parsed.data.paths.map(async (path) => {
      try {
        return await fetchRouteGeometry(path as LngLat[]);
      } catch (err) {
        if (!(err instanceof GeometryError)) {
          console.warn("[route-geometry] unexpected failure:", err);
        }
        return null;
      }
    }),
  );

  return NextResponse.json(
    {
      geometries: results,
      maxCoordinates: MAX_GEOMETRY_COORDINATES,
      // The client needs to know it is drawing approximations so it can say so.
      degraded: results.some((r) => r === null),
    },
    { headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } },
  );
}

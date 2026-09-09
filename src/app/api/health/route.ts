import { NextResponse } from "next/server";
import { activeProvider } from "@/lib/geocode";
import { listSolvers } from "@/lib/solver";
import { MAX_STOPS } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and configuration, for whatever is watching the container.
 *
 * Deliberately not rate limited: a health check that can be throttled will be
 * throttled at exactly the wrong moment, and an orchestrator seeing 429 will
 * restart a process that was working fine.
 *
 * It reports which services are configured but does not call them. A health
 * check that reaches out to OSRM and Nominatim on every poll turns a monitoring
 * interval into traffic against someone else's rate limit, and makes the app
 * look unhealthy when a degradable dependency is down — the whole point of the
 * haversine fallback is that a missing matrix service is not an outage.
 */
export async function GET() {
  const engines = listSolvers();

  return NextResponse.json(
    {
      status: "ok",
      maxStops: MAX_STOPS,
      geocoder: activeProvider(),
      // Configured, not verified — see the note above.
      routing: process.env.OSRM_BASE_URL ? "configured" : "default (public demo)",
      engines: Object.fromEntries(engines.map((e) => [e.name, e.available])),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

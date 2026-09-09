import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { MAX_STOPS } from "@/lib/schema";
import { MAX_QUERIES_PER_REQUEST } from "@/lib/limits";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "API — RoutePlan",
  description:
    "The public routing API. No key, no account. The same endpoint the app itself calls on every plan.",
};

/**
 * Rendered per request.
 *
 * The Content-Security-Policy in middleware.ts carries a per-request nonce, and
 * a statically prerendered page has no request to take one from — Next emits it
 * with no nonce and the policy then blocks every script on the page. In
 * development that never shows up, because dev renders everything dynamically.
 */
export const dynamic = "force-dynamic";

export default function ApiDocsPage() {
  return (
    <SiteShell>
      <article className={styles.prose}>
        <h1 className={styles.pageTitle}>API</h1>
        <p className={styles.lede}>
          No key, no account, no rate-limit tier to buy. This is the same
          endpoint the map calls — there is no private path from the app to the
          solver, so the API is exercised on every plan and cannot quietly rot.
        </p>

        <h2>Plan a route</h2>
        <p>
          One <code>POST</code>. The depot, your stops, how many vehicles.
          Everything else has a sensible default.
        </p>
        <pre className={styles.code}>{`curl -X POST https://your-host/api/v1/solve \\
  -H 'Content-Type: application/json' \\
  -d '{
    "depot": { "lat": 48.8443, "lng": 2.3743 },
    "stops": [
      { "id": "s1", "label": "Louvre",     "lat": 48.8606, "lng": 2.3376 },
      { "id": "s2", "label": "Notre-Dame", "lat": 48.8530, "lng": 2.3499 }
    ],
    "vehicles": [{ "id": "v1" }, { "id": "v2" }],
    "options": { "objective": "balanced", "roundTrip": true }
  }'`}</pre>

        <p>You get back the routes, in order, with the numbers already worked out:</p>
        <pre className={styles.code}>{`{
  "routes": [{
    "vehicleId": "v1",
    "vehicleIndex": 0,
    "stops": [{
      "stopId": "s1",
      "stopIndex": 0,
      "sequence": 0,
      "arrivalOffset": 412,          // seconds from departure
      "distanceFromPrevious": 3820.4 // metres
    }],
    "totalDistance": 7640,
    "totalDuration": 1224
  }],
  "summary": {
    "totalDistance": 7640,
    "longestRouteDistance": 7640,
    "vehiclesUsed": 1,
    "stopsServed": 2,
    "baselineDistance": 8100        // your list order, for comparison
  },
  "meta": {
    "solver": "greedy",
    "solveTimeMs": 3,
    "matrixSource": "osrm",         // or "haversine" — see below
    "warnings": []
  }
}`}</pre>

        <div className={styles.aside}>
          Distances are always metres and durations always seconds. Formatting
          happens at the edge, never in the data.
        </div>

        <h2>Endpoints</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th style={{ textAlign: "left" }}>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>GET /api/v1/solve</code></td>
              <td style={{ textAlign: "left" }}>
                Available engines and objectives. The app&apos;s own selector
                reads this, so it never hardcodes engine names.
              </td>
            </tr>
            <tr>
              <td><code>POST /api/v1/solve</code></td>
              <td style={{ textAlign: "left" }}>Plan routes. The one that matters.</td>
            </tr>
            <tr>
              <td><code>POST /api/v1/geocode</code></td>
              <td style={{ textAlign: "left" }}>
                Addresses to coordinates, up to {MAX_QUERIES_PER_REQUEST} at a
                time. Returns a precision grade and any alternatives.
              </td>
            </tr>
            <tr>
              <td><code>POST /api/v1/route-geometry</code></td>
              <td style={{ textAlign: "left" }}>
                Road shapes for drawing. Separate from the plan on purpose: a
                failure here costs you the drawing, not the routes.
              </td>
            </tr>
            <tr>
              <td><code>POST /api/v1/share</code></td>
              <td style={{ textAlign: "left" }}>
                Encode a plan into a URL. There is no database — the link is the
                storage.
              </td>
            </tr>
            <tr>
              <td><code>GET /api/health</code></td>
              <td style={{ textAlign: "left" }}>
                Liveness and which services are configured.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Options</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Default</th>
              <th style={{ textAlign: "left" }}>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>objective</code></td>
              <td><code>balanced</code></td>
              <td style={{ textAlign: "left" }}>
                <code>balanced</code> evens the workload; <code>distance</code>{" "}
                minimises total kilometres and may leave vehicles idle.
              </td>
            </tr>
            <tr>
              <td><code>roundTrip</code></td>
              <td><code>true</code></td>
              <td style={{ textAlign: "left" }}>
                False means each vehicle finishes at its last stop.
              </td>
            </tr>
            <tr>
              <td><code>defaultServiceTime</code></td>
              <td><code>300</code></td>
              <td style={{ textAlign: "left" }}>
                Seconds at each stop. Overridable per stop.
              </td>
            </tr>
            <tr>
              <td><code>solver</code></td>
              <td><code>greedy</code></td>
              <td style={{ textAlign: "left" }}>
                <code>greedy</code> is always available. <code>ortools</code>{" "}
                needs a sidecar; ask <code>GET /api/v1/solve</code> what is on.
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Errors</h2>
        <p>
          Every error is a code and a sentence written for a person, never a
          stack trace.
        </p>
        <pre className={styles.code}>{`{
  "error": {
    "code": "TOO_MANY_STOPS",
    "message": "This plan has 140 stops. The limit is ${MAX_STOPS}. Split it into two plans."
  }
}`}</pre>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>HTTP</th>
              <th style={{ textAlign: "left" }}>Cause</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>INVALID_PROBLEM</code></td><td>400</td><td style={{ textAlign: "left" }}>Malformed body. <code>detail</code> names the fields.</td></tr>
            <tr><td><code>TOO_MANY_STOPS</code></td><td>413</td><td style={{ textAlign: "left" }}>Over {MAX_STOPS} stops.</td></tr>
            <tr><td><code>SOLVER_UNAVAILABLE</code></td><td>400</td><td style={{ textAlign: "left" }}>That engine is not set up here.</td></tr>
            <tr><td><code>SOLVER_TIMEOUT</code></td><td>504</td><td style={{ textAlign: "left" }}>The engine took too long.</td></tr>
            <tr><td><code>INFEASIBLE</code></td><td>400</td><td style={{ textAlign: "left" }}>No plan satisfies the constraints.</td></tr>
            <tr><td><code>RATE_LIMITED</code></td><td>429</td><td style={{ textAlign: "left" }}>Too many requests. <code>Retry-After</code> says how long.</td></tr>
          </tbody>
        </table>

        <h2>Two things worth knowing</h2>
        <p>
          <strong>It degrades rather than failing.</strong> If road distances are
          unavailable you still get a plan, computed from straight-line estimates,
          with <code>meta.matrixSource</code> set to <code>haversine</code> and a
          warning attached. Check that field before presenting distances as fact.
        </p>
        <p>
          <strong>Vehicles are always an array of objects</strong>, even when you
          only care about the count. Heterogeneous fleets — two vans and a bike —
          are the first thing real operators ask for, and an integer count would
          be a breaking change later.
        </p>

        <h2>Rate limits</h2>
        <p>
          Per IP, per minute: 20 plans, 60 geocodes. Every response carries{" "}
          <code>RateLimit-Limit</code> and <code>RateLimit-Remaining</code> so you
          can slow down before being refused rather than after.
        </p>

        <div className={styles.aside}>
          Running your own copy removes all of this. It is MIT licensed and the{" "}
          <a href="https://github.com/emailartificialintelligence/RouteOpt" target="_blank" rel="noreferrer noopener">source is on GitHub</a>.
        </div>

        <p style={{ marginTop: 28 }}>
          <Link href="/plan" className={styles.ctaLarge}>
            Try it in the app
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}

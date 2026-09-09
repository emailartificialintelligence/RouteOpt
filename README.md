# RoutePlan

An open-source route optimiser for small delivery operations. Paste addresses,
set a depot, pick a vehicle count, get routes you can hand to drivers.

No account. No database. The share link *is* the persistence layer.

```bash
npm install
cp .env.example .env.local     # then read it — the defaults are dev-only
npm run dev
```

Open <http://localhost:3000>.

## What it does

Paste or upload stops → geocode and **confirm every pin** → set a depot → choose
vehicles → solve → routes on a map → per-driver manifest, Google Maps link,
print → share URL.

Deliberately absent: accounts, auth, saved history, teams, billing, live driver
tracking, proof of delivery, customer notifications, real-time re-optimisation.
Each is a separate product.

## The API is the app

Every solve goes through `POST /api/v1/solve`. The map is a client of the public
API, exactly as an external caller would be — so the API is exercised on every
interaction and cannot quietly rot before the day it gets documented.

```bash
curl -X POST http://localhost:3000/api/v1/solve \
  -H 'Content-Type: application/json' \
  -d @examples/paris.json
```

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/solve` | Available engines and objectives — feeds the UI selector |
| `POST /api/v1/solve` | Plan routes. The one that matters |
| `POST /api/v1/geocode` | Addresses → coordinates, batched and throttled |
| `POST /api/v1/route-geometry` | Road shapes for drawing. Failure is cosmetic |
| `POST /api/v1/share` | Encode a plan into a URL |
| `GET /r/<payload>` | Read-only shared plan |

Errors are user-facing copy, never stack traces:

```json
{ "error": { "code": "TOO_MANY_STOPS", "message": "This plan has 140 stops. The limit is 99. Split it into two plans." } }
```

Codes: `INVALID_PROBLEM`, `TOO_MANY_STOPS`, `MATRIX_UNAVAILABLE`,
`SOLVER_TIMEOUT`, `SOLVER_UNAVAILABLE`, `UNKNOWN_SOLVER`, `INFEASIBLE`,
`RATE_LIMITED`, `INTERNAL`.

## Engines

| Name | Label | Needs | Speed | Quality |
|---|---|---|---|---|
| `greedy` | Fast | nothing | ~10 ms | good |
| `ortools` | Balanced | [sidecar](sidecar/README.md) | ~5 s | better |
| `pyvrp`, `vroom` | — | not built | — | — |

Measured on 40 stops / 3 vans with real road distances: greedy 90.0 km in 7 ms;
OR-Tools 76.0 km in 5 s optimising for total distance, or a shorter longest-route
when balancing. The **Compare engines** button in the UI runs both on your own
problem and shows the trade.

Adding an engine is a file plus a registry entry in `src/lib/solver/index.ts`.

## Deploying

Two supported paths:

- **[VERCEL.md](VERCEL.md)** — 10 minutes, no servers. Ships with the Fast
  engine and public road-distance data (99-stop cap). The quick way to be live.
- **[DEPLOY.md](DEPLOY.md)** — one virtual machine with Docker. Runs the
  OR-Tools engine and your own routing server, which lifts the stop cap. About
  30 minutes plus map processing.

## Before you deploy

The defaults in `.env.example` are for development. Three of them will bite.

**Geocoding.** Nominatim's public instance allows one request per second and
will block a deployment that leans on it — 40 addresses takes 44 seconds.
Switch to Photon, or self-host:

```
GEOCODER_PROVIDER=photon        # ~4s for the same 40 addresses
GEOCODER_USER_AGENT=YourApp/1.0 (you@example.com)
```

The User-Agent is not optional for Nominatim: it answers `403`, not
`200`-with-no-results, when it cannot attribute a request.

**Road distances.** `router.project-osrm.org` is a demo server, explicitly not
for production, and its 100-coordinate table limit is why `MAX_STOPS` is 99
(the depot takes a slot). Self-host and raise it:

```bash
docker run -p 5000:5000 -v "$PWD/data:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld /data/region.osrm
```

```
OSRM_BASE_URL=http://localhost:5000
```

When the matrix service is unreachable the app degrades to straight-line
distances and says so in the UI, rather than failing. That is intentional, but
it is a fallback, not a plan.

**Rate limiting.** `TRUST_PROXY=true` only if a proxy really is in front —
`x-forwarded-for` is trivially spoofed, and trusting it without a proxy hands
anyone an unlimited quota. Limits are per IP per minute and process-local, which
is correct for one instance and wrong for two: move `src/lib/rate-limit.ts` to
Redis before scaling out.

See [MAPLIBRE_VERSION.md](MAPLIBRE_VERSION.md) for why maplibre-gl is pinned to
4.7.1 and what has to happen before that changes.

## Architecture

```
Browser ──POST /api/v1/solve──> route handler
                                    │
                          validate (Zod schema)
                                    │
                          build matrix (OSRM ─or─ haversine fallback)
                                    │
                          solverRegistry[name].solve(problem, matrix)
                                    │
                              Solution JSON
```

Three rules that keep later work cheap:

1. **Every engine implements one interface.** `solve(problem, matrix) => Solution`.
2. **The wire schema is versioned and forward-compatible.** Fields for capacity,
   time windows and heterogeneous fleets exist now and are nullable. Vehicles
   are an array of objects, never an integer count.
3. **The matrix is a separate concern from the solver.** Engines receive a
   matrix; they never fetch one.

Leg distances, arrival offsets and totals live in `src/lib/solver/assemble.ts`
and are shared by every engine, so the comparison view compares routing rather
than two implementations of arithmetic.

## Tests

```bash
npm test          # 218 tests
npm run typecheck
```

Solver correctness is tested against instances whose optimum is known by
construction, not just against "did it improve". Two rules are enforced as
tests because both failures are invisible in review: marker elements must never
have `className` assigned (it strips MapLibre's positioning class), and nothing
may hand untrusted content to `setHTML` or `innerHTML` — share links carry
labels written by whoever built the URL.

## Licence

MIT.

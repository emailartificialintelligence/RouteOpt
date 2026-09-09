# RoutePlan — Build Plan

An open-source route optimizer for small delivery operations. One-shot use: paste
addresses, set a depot, pick a vehicle count, get routes you can hand to drivers.

## Product boundary

**In scope for v1**
Paste or upload stops → geocode and confirm → set depot → set vehicle count →
solve → routes on a map → per-driver manifest, Google Maps link, print → share URL.

**Deliberately out of scope**
Accounts, auth, saved history, teams, billing, live driver tracking, proof of
delivery, customer notifications, mobile app, real-time re-optimization. Each is a
separate product. Adding any of them to v1 turns an eight-week build into a year.

## Stack

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router) + TypeScript | API routes give the public `/api/v1/solve` endpoint for free |
| Validation | Zod | One schema, runtime validation + inferred types |
| Map | MapLibre GL JS | No API key, no vendor lock, vector tiles |
| Basemap tiles | OpenFreeMap or CARTO Positron | Free, muted — route colors need to sit on top |
| Road distances | OSRM `/table` | Self-hostable; the public demo server is dev-only |
| Geocoding | Nominatim (dev) → Photon or self-hosted Nominatim (prod) | Rate limits will bite; plan the swap early |
| Share encoding | fflate gzip + base64url | Isomorphic, no database in v1 |
| Tests | Vitest | Solver correctness needs real tests |

No database in v1. The share link is the persistence layer.

## Architecture, in one line

The UI is a client of the public API. There is no private path from the map to the solver.

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

Three rules that make later phases cheap:

1. **Every solver implements one interface.** `solve(problem, matrix) => Solution`.
   Adding OR-Tools later is a new file and a registry entry, not a refactor.
2. **The wire schema is versioned and forward-compatible.** Fields for capacity,
   time windows and per-vehicle heterogeneity exist now and are nullable. Vehicles
   are an array of objects, never an integer count.
3. **The matrix is a separate concern from the solver.** Solvers receive a matrix,
   they never fetch one. That makes them pure and testable.

## Phases

### Phase 1 — Core (build first, no UI)
- `schema.ts`, `matrix.ts`, `solver/greedy.ts`, `api/v1/solve/route.ts`
- Vitest suite: known-optimal small instances, degenerate cases (1 stop, 0 stops,
  more vehicles than stops, duplicate coordinates)
- Verify by curl before any pixel is drawn

### Phase 2 — Map and input
- MapLibre canvas, depot pin, stop pins
- Paste-a-list panel → geocode → **confirmation step showing every pin before solve**
- CSV upload (`label,address` or `label,lat,lng`)
- Click-to-add and drag-to-move for editing, not bulk entry

### Phase 3 — Solve and output
- Vehicle count, objective toggle, round-trip toggle
- Solver selector: Greedy enabled; OR-Tools, PyVRP, VRoom disabled with a
  "Coming soon" tooltip — disabled without explanation reads as broken
- Route polylines in categorical colors, per-vehicle summary cards
- Baseline comparison: optimized total vs. the order the user pasted
- Google Maps deep link per route, print stylesheet for the manifest

### Phase 4 — Share and API surface
- `POST /api/v1/share` → versioned encoded payload in the URL
- `/r/[payload]` renders a read-only solved plan
- **"View as API request"** on every result: the exact JSON and a curl command.
  This is the conversion path from one-shot user to API user, and it makes the
  docs write themselves.

### Phase 5 — Second solver
Add OR-Tools behind the same interface (Python sidecar or WASM). Enable the toggle.
Ship the comparison view: same problem, every engine, one table of distance /
longest route / vehicles used / solve time.

## Known traps

- **Geocoding silently placing a stop in the wrong country.** Always render pins
  for confirmation before solving. A wrong pin produces a nonsense route and
  destroys trust permanently.
- **The OSRM demo server.** Rate-limited, 100-coordinate table ceiling, explicitly
  not for production. Cap MVP problems at 100 stops and make the base URL an env var.
- **Crossing routes.** Users read overlapping polylines as "the software is broken"
  even when total distance is fine. Cluster-first-route-second exists to prevent
  this — do not replace it with a global nearest-neighbour sweep.
- **Synchronous solve.** Fine at 100 stops. Move to a job queue before raising the cap.
- **Share URL length.** ~100 stops compresses to a few KB of base64. Acceptable in
  modern browsers, but Phase 5 should move payloads server-side behind a short id.
- **Unbounded problem size.** Cap stops and solve time, or one pasted spreadsheet
  sets your compute bill.

## Definition of done for v1

A person with 40 addresses and 3 vans can, without signing up, paste their list,
get three sensible routes, send each driver a Google Maps link, and share the plan
with a colleague — in under two minutes.

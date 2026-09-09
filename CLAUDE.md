# CLAUDE.md

Project instructions for Claude Code. Read `BUILD_PLAN.md` for scope and phasing.

## What this is

RoutePlan: an open-source route optimizer for small delivery operations. The user
is a dispatcher or owner-operator with 20–80 stops and 2–6 vehicles who needs a
route once, today, without creating an account.

## Non-negotiable architecture rules

1. **The UI calls the public API.** Every solve goes through `POST /api/v1/solve`.
   Never import a solver directly into a React component or a server component.
   If you find yourself passing solver state through props, stop and fix the boundary.

2. **Solvers implement `Solver` from `src/lib/solver/types.ts`.** They are pure:
   `(problem, matrix) => Solution`. They never fetch, never read env vars, never
   touch the network. Adding an engine means adding a file and a registry entry.

3. **The wire schema in `src/lib/schema.ts` is a contract.** Share links encode it,
   so changing it breaks existing URLs. Add optional fields; never rename or remove
   one without bumping `SCHEMA_VERSION` and writing a migration.

4. **Vehicles are always an array of objects**, even when the UI shows a number
   input. `expandVehicleCount()` does the conversion. Do not "simplify" this to an
   integer — heterogeneous fleets are the first thing users ask for.

5. **No database in v1.** If a feature needs persistence, it is out of scope.

## Code conventions

- TypeScript strict mode. No `any` in `src/lib`.
- Distances in **meters**, durations in **seconds**, internally. Format at the edge only.
- Coordinates are `{ lat, lng }` objects in the schema, but `[lng, lat]` in anything
  touching MapLibre or OSRM. This ordering mismatch causes most map bugs — convert
  at the boundary with a named helper, never inline.
- Matrix index 0 is always the depot. Stops are 1..n in problem order.
- Pure functions in `src/lib`, side effects in route handlers and components.
- Vitest for solver logic. Every solver change needs a test.

## Error handling

Errors are user-facing copy, not stack traces. The API returns:

```json
{ "error": { "code": "GEOCODE_FAILED", "message": "...", "detail": {...} } }
```

Codes: `INVALID_PROBLEM`, `TOO_MANY_STOPS`, `MATRIX_UNAVAILABLE`, `SOLVER_TIMEOUT`,
`UNKNOWN_SOLVER`. Every message says what happened and what to do next. When the
matrix service is down, fall back to straight-line distances and set
`solution.meta.matrixSource = "haversine"` so the UI can warn that distances are
approximate — degrade, don't fail.

## Design direction

The vernacular is dispatch paperwork and transit signage, not SaaS marketing.
This is a working instrument. The map is the product; chrome stays quiet.

**Do not produce:** cream background with terracotta accent, identical rounded
cards with soft grey shadows, all-caps eyebrow labels, gradient washes, arrows
appended to button text, fade-up animations on every section.

**Tokens**

```css
--paper:    #FBFAF7;  /* manifest stock */
--ink:      #101B2E;  /* navy-black, structural text */
--ink-soft: #55606E;  /* secondary text */
--rule:     #D8D3C8;  /* hairline dividers */
--signal:   #0B5D8A;  /* transit blue: primary actions, depot marker */
--warn:     #B45309;  /* amber: approximate distances, unsolved stops */
```

Route colors, in order. Chosen to stay distinguishable against a muted basemap and
to survive black-and-white printing at different weights:

```
#0B5D8A  #B3261E  #1B7A3E  #8A5A00  #6B3FA0  #B8005C  #00706B  #A03E00
```

**Type:** Atkinson Hyperlegible Next throughout. It is a legibility typeface, and
legibility is the actual brief — a dispatcher scans a stop list, a driver reads a
printed manifest in a van. Use its tabular numerals (`font-variant-numeric:
tabular-nums`) for all distances, times and counts so columns align. One family;
no mono face for data labels.

**Layout:** full-bleed map with a fixed left rail (360px) holding input and results.
The rail is dense and left-aligned, closer to a route sheet than a dashboard. On
mobile the rail becomes a bottom sheet. Numbers get room; labels stay small and
sentence case.

**Motion:** one place only — when a solve completes, routes draw on with a short
staggered path animation, one vehicle after another. That single orchestrated
moment shows what changed. Nothing else animates on load. Respect
`prefers-reduced-motion`.

**Copy:** plain verbs, sentence case, active voice. The button says "Plan routes"
and the result heading says "Routes planned." Empty state is an instruction, not a
mood: "Paste your delivery addresses, one per line." Errors state what happened and
the fix: "Three addresses didn't match. Check them on the map before planning."

## Build order

Follow `BUILD_PLAN.md` phases. Phase 1 has no UI at all — get `curl` returning
correct routes with a passing test suite before drawing anything.

## Provided files

`src/lib/schema.ts`, `src/lib/matrix.ts`, `src/lib/solver/types.ts`,
`src/lib/solver/greedy.ts`, `src/lib/solver/index.ts`, `src/lib/share.ts`,
`src/app/api/v1/solve/route.ts` are written and reviewed. Extend them; don't
rewrite them without a stated reason.

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

The house style follows DocExtract: a zinc palette on white, near-black primary
actions, hairline borders, generous radii, and a faint dotted ground behind the
marketing pages. Geist for text, Geist Mono for code. The map is still the
product; chrome stays quiet.

**Tokens**

```css
--paper:        #FFFFFF;  /* page */
--paper-sunk:   #FAFAFA;  /* insets, code blocks */
--paper-muted:  #F4F4F5;  /* hover, selected rows */
--ink:          #09090B;  /* text */
--ink-soft:     #71717A;  /* secondary text */
--rule:         #E4E4E7;  /* hairlines */
--rule-strong:  #D4D4D8;  /* button borders */
--primary:      #18181B;  /* primary actions */
--on-primary:   #FAFAFA;
--warn:         #B45309;  /* approximate distances, unsolved stops */
--radius:       10px;     /* cards, panels */
--radius-sm:    6px;      /* buttons, inputs */
```

**The map keeps its own colours.** Route hues are chosen to stay distinguishable
from each other on a muted basemap and to survive black-and-white printing, and
the depot stays transit blue (`--signal: #0B5D8A`) so it reads as a different
kind of thing from a stop. Those are functional, not decorative, so the theme
stops at the edge of the canvas.

Route colors, in order:

```
#0B5D8A  #B3261E  #1B7A3E  #8A5A00  #6B3FA0  #B8005C  #00706B  #A03E00
```

**Type:** Geist throughout, Geist Mono for code and API snippets. Use tabular
numerals (`font-variant-numeric: tabular-nums`) for all distances, times and
counts so columns align — a dispatcher scans those vertically.

This replaced Atkinson Hyperlegible Next, which was chosen for a legibility
brief: a driver reading a printed manifest in a van. Geist keeps proper tabular
figures, which is the part the stop list depends on. If the printed manifest
ever proves hard to read in the field, that trade is the first thing to revisit.

**Layout:** the marketing pages are centred, max 940px, with a sticky
translucent header. The tool at `/plan` splits 35% rail / 65% map, with no site
header — someone on that page is working. The rail was a fixed 360px, sized
around the input form; a solved plan puts per-driver summaries, downloads and
the engine comparison in that column, so it scales with the window instead. On
mobile the rail becomes a bottom sheet.

**Motion:** subtle, short, and always tied to something real.

- Sections on the marketing pages fade up 14px as they come into view, once
  each. Content already on screen at load renders immediately — animating what
  someone came to read, before they can read it, is a tax not a flourish.
- Cards and the hero figure lift 2–3px under the pointer.
- The arrow on a primary action nudges on hover.
- Routes draw on after a solve, one vehicle after another. That remains the one
  orchestrated moment in the product.

Two rules that are not negotiable. **A reveal must never be the only thing
standing between a reader and the words**: the observer that drives it has a
failsafe timer, because a callback that does not fire would otherwise leave the
page permanently blank. And **`prefers-reduced-motion` means none, not less** —
the reduced branch renders the final state with no transition, rather than a
faster one.

**Copy:** plain verbs, sentence case, active voice. The button says "Plan
routes" and the result heading says "Routes planned." Empty state is an
instruction, not a mood: "Paste your delivery addresses, one per line." Errors
state what happened and the fix: "Three addresses didn't match. Check them on
the map before planning."

## Build order

Follow `BUILD_PLAN.md` phases. Phase 1 has no UI at all — get `curl` returning
correct routes with a passing test suite before drawing anything.

## Provided files

`src/lib/schema.ts`, `src/lib/matrix.ts`, `src/lib/solver/types.ts`,
`src/lib/solver/greedy.ts`, `src/lib/solver/index.ts`, `src/lib/share.ts`,
`src/app/api/v1/solve/route.ts` are written and reviewed. Extend them; don't
rewrite them without a stated reason.

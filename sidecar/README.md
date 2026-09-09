# OR-Tools sidecar

The "Balanced" engine. OR-Tools is a C++ library with Python bindings and no
usable JavaScript build, so it runs as a separate process and the app talks to
it over HTTP.

## Running it

```bash
python -m venv sidecar/.venv
sidecar/.venv/bin/pip install ortools
sidecar/.venv/bin/python sidecar/solver.py     # 127.0.0.1:8081
```

Then point the app at it and restart the dev server so it picks up the change:

```
ORTOOLS_URL=http://127.0.0.1:8081
```

Without `ORTOOLS_URL` the engine appears in the selector marked as not set up,
and the app plans with Fast. That is deliberate: an engine offered as available
that then fails on every request is worse than one honestly switched off.

Check it is alive:

```bash
curl http://127.0.0.1:8081/health
```

## The protocol

`POST /solve` takes a matrix and returns **only the assignment**:

```jsonc
// request
{
  "distances": [[0, 1200], [1200, 0]],   // metres, index 0 is the depot
  "durations": [[0, 145],  [145, 0]],    // seconds
  "vehicleCount": 2,
  "roundTrip": true,
  "objective": "balanced",               // or "distance"
  "timeBudgetMs": 10000
}

// response — matrix indices per vehicle, depot excluded
{ "routes": [[1, 3], [2]], "solveTimeMs": 4980 }
```

Leg distances, arrival offsets and totals are **not** computed here. The
TypeScript side does that with the same code the built-in engine uses, so the
comparison view compares routing rather than two implementations of arithmetic
in two languages. Adding those here would be the fastest way to make two
engines quietly disagree about the same route.

## Operational notes

- **Bind to localhost.** It does real CPU work on unvalidated input and has no
  authentication. It is not meant to face the internet.
- **It is CPU-bound and roughly single-threaded per solve.** `timeBudgetMs` is
  a floor on how long a request takes, not a ceiling on quality — OR-Tools uses
  the whole budget. Five seconds per solve is normal.
- **`MAX_NODES` is 250.** Larger matrices are refused rather than left to run
  for minutes.
- **The app degrades rather than fails.** If the sidecar is down, a solve with
  the Balanced engine returns a message telling the user to plan with Fast; the
  rest of the app is unaffected.

## Objectives

`distance` minimises total kilometres and will happily leave vehicles idle —
on a 40-stop test it put every stop on one van for 76 km, against 91 km spread
over three. `balanced` adds a span cost on a distance dimension, which is what
"everyone finishes around the same time" actually means, and cost about 15 km
of total distance to even the routes out.

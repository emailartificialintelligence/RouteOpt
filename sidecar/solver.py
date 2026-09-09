"""
Solving sidecar for RoutePlan.

Why a separate process: OR-Tools, PyVRP and VROOM are all C++ libraries with
Python bindings and no usable JavaScript build. Rather than compromise the
engines, they run beside the app and speak a small JSON protocol over HTTP.

The protocol is deliberately narrow. This service receives a problem and a
distance matrix and returns *only the assignment* — which stops each vehicle
visits, in order. It does not compute arrival times, leg distances or totals.
All of that is arithmetic the TypeScript side already does for the built-in
engine, and duplicating it here in another language is how solvers end up
quietly disagreeing about the same route.

Three engines, one process. They share a container because they are the same
shape of dependency and because a second container to hold one pip package is
cost and operational surface for nothing. Each is optional: an engine that fails
to import is reported as unavailable rather than taking the service down with
it, so a deployment that can only install two of the three still serves those.

Run it:

    pip install -r sidecar/requirements.txt
    python sidecar/solver.py            # listens on 127.0.0.1:8081

Then point the app at it:

    SIDECAR_URL=http://127.0.0.1:8081

Bind to localhost only unless SIDECAR_TOKEN is set. This endpoint does real CPU
work on unvalidated input.
"""

from __future__ import annotations

import hmac
import json
import os
import signal
import sys
import threading
import time
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("ORTOOLS_HOST", "127.0.0.1")

# PORT before ORTOOLS_PORT.
#
# Cloud Run, and most container hosts, inject the port to listen on as PORT and
# health-check that exact port. A service that listens somewhere else never
# passes its first check and is killed before it serves anything — with a log
# that says only "container failed to start".
PORT = int(os.environ.get("PORT") or os.environ.get("ORTOOLS_PORT") or "8081")

# Shared secret.
#
# On a single VM this service sits on a private network and needs no auth. Hosted
# on its own — beside a Vercel app, say — it is on the public internet, and it
# will happily spend seconds of CPU on any request that arrives. Set
# SIDECAR_TOKEN there and the app sends it as a bearer token.
#
# ORTOOLS_TOKEN is still read because it is what existing deployments set, and
# renaming a secret that is already in production is an outage, not a cleanup.
#
# Empty means no check, which is correct for the private-network case and wrong
# for anything reachable from outside. The startup log says which mode it is in
# so nobody discovers it from a bill.
SIDECAR_TOKEN = (
    os.environ.get("SIDECAR_TOKEN") or os.environ.get("ORTOOLS_TOKEN") or ""
).strip()

# A matrix bigger than this means something upstream is wrong; refuse rather
# than spend minutes on it.
MAX_NODES = 250

# Hard ceiling regardless of what the caller asks for, so one request cannot
# occupy the process indefinitely.
#
# Configurable because the right value depends on where this runs. On a free
# tier that bills by CPU-second, or behind a platform with its own request
# timeout, a shorter cap is the difference between a working engine and one
# that always times out. The caller may ask for less; it can never ask for more.
MAX_TIME_BUDGET_MS = int(
    os.environ.get("SIDECAR_MAX_BUDGET_MS")
    or os.environ.get("ORTOOLS_MAX_BUDGET_MS")
    or "60000"
)

# These engines work in integers. Distances arrive in metres and may be floats.
SCALE = 1


# --------------------------------------------------------------- engine imports
#
# Imported eagerly so a broken install is discovered at startup and printed in
# the boot log, not on the first request from a user. Each failure is recorded
# rather than raised: two working engines are worth serving.

ENGINE_IMPORT_ERROR: dict[str, str] = {}

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
except ImportError as exc:  # pragma: no cover - import guard, not logic
    ENGINE_IMPORT_ERROR["ortools"] = str(exc)

try:
    import pyvrp
    from pyvrp.stop import MaxRuntime
except ImportError as exc:  # pragma: no cover
    ENGINE_IMPORT_ERROR["pyvrp"] = str(exc)

try:
    import vroom
except ImportError as exc:  # pragma: no cover
    ENGINE_IMPORT_ERROR["vroom"] = str(exc)


def engine_available(name: str) -> bool:
    return name in ENGINES and name not in ENGINE_IMPORT_ERROR


# ------------------------------------------------------------------- helpers


def route_distance(order, distances, depot, round_trip):
    """
    What one vehicle actually drives, in matrix units.

    Used to steer the balanced objective for the engines that have no built-in
    min-max. It deliberately mirrors the TypeScript side's arithmetic: an open
    route stops at its last delivery and is not charged for going home.
    """
    if not order:
        return 0
    total = distances[depot][order[0]]
    for a, b in zip(order, order[1:]):
        total += distances[a][b]
    if round_trip:
        total += distances[order[-1]][depot]
    return total


def longest_route(routes, distances, depot, round_trip):
    if not routes:
        return 0
    return max(route_distance(r, distances, depot, round_trip) for r in routes)


def open_route_matrix(distances, depot):
    """
    A copy in which returning to the depot is free.

    There is no "finish nowhere" in any of these engines, so an open route is
    modelled as a round trip whose last leg costs nothing. OR-Tools expresses
    that in its cost callback; PyVRP and VROOM take a matrix, so they get one.
    """
    out = [list(row) for row in distances]
    for row in out:
        row[depot] = 0
    return out


def balanced_cap_search(solve_once, distances, depot, round_trip, vehicle_count,
                        budget_ms, probes=4):
    """
    Approximate min-max for engines that only minimise the total.

    OR-Tools has a span cost, which is a real min-max objective. PyVRP and VROOM
    do not — both minimise total distance. Left alone on a round trip they do
    the arithmetically correct and operationally useless thing: put every stop
    on one vehicle, because a second van costs a second trip out to the round
    and back. Measured on 40 stops and 4 vans, that is one driver doing 239km
    and three doing nothing.

    Both, however, accept a per-vehicle distance cap. Minimising the longest
    route is then a search for the smallest cap that still admits a plan, which
    is a binary search:

        lower bound   total / vehicles, a perfectly even split — no cap below
                      this can be satisfied, so there is no point probing there
        upper bound   the longest route of the uncapped plan, which is feasible
                      by construction

    Four probes lands within a few percent of the bound, which is the accuracy
    worth paying for: each probe is a whole solve, and this is a heuristic
    either way.

    A relative descent — repeatedly asking for 8% better than the last answer —
    was the obvious first attempt and is much worse. Starting from a
    one-vehicle plan it converges toward the balanced answer geometrically,
    and runs out of probes long before it arrives.

    `solve_once(cap, budget)` returns routes or None. A cap of None means
    unconstrained; None back means no plan satisfies that cap.
    """
    # The first pass gets the largest single share: it establishes the upper
    # bound, and every probe after it is refinement of a plan that already works.
    first_budget = max(1, int(budget_ms * 0.3))
    best = solve_once(None, first_budget)
    if best is None:
        return None

    best_longest = longest_route(best, distances, depot, round_trip)
    total = sum(route_distance(r, distances, depot, round_trip) for r in best)

    low = max(1, total // max(1, vehicle_count))
    high = best_longest
    probe_budget = max(1, int((budget_ms - first_budget) / probes))

    for _ in range(probes):
        # Stop once the bracket is inside 2%: further probes cost a full solve
        # each and move the answer by less than rounding to the nearest km.
        if high - low <= max(1, low // 50):
            break
        mid = (low + high) // 2
        candidate = solve_once(mid, probe_budget)
        if candidate is None:
            # That cap was too tight — or too tight to satisfy in the time
            # given. Either way nothing below it is worth probing.
            low = mid + 1
            continue
        candidate_longest = longest_route(candidate, distances, depot, round_trip)
        if candidate_longest < best_longest:
            best, best_longest = candidate, candidate_longest
        # Believe the plan, not the cap: an engine asked for 100k may return
        # 82k, and the next probe should bracket against what it achieved.
        high = min(mid, candidate_longest)

    return best


# ------------------------------------------------------------------- OR-Tools


def solve_ortools(distances, durations, vehicle_count, depot, round_trip,
                  objective, time_budget_ms):
    """
    Returns a list of routes, each a list of *node indices* (matrix indices),
    excluding the depot. Index 0 is the depot; stops are 1..n.
    """
    node_count = len(distances)

    if round_trip:
        manager = pywrapcp.RoutingIndexManager(node_count, vehicle_count, depot)
    else:
        # An open route still starts at the depot but may finish anywhere. There
        # is no "finish nowhere" in OR-Tools, so every vehicle is given a
        # zero-cost virtual end at the depot and the returning leg is priced at
        # zero in the cost callback below.
        manager = pywrapcp.RoutingIndexManager(
            node_count, vehicle_count,
            [depot] * vehicle_count, [depot] * vehicle_count,
        )

    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        if not round_trip and j == depot:
            # Going home is free on an open route: the driver simply stops.
            return 0
        return int(round(distances[i][j] * SCALE))

    transit = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit)

    if objective == "balanced":
        """
        Minimising total distance alone happily gives one driver twenty stops
        and another two. A distance dimension with a span cost penalises the
        longest route, which is what "everyone finishes around the same time"
        actually means.
        """
        horizon = int(sum(sum(row) for row in distances) * SCALE) or 1
        routing.AddDimension(transit, 0, horizon, True, "Distance")
        routing.GetDimensionOrDie("Distance").SetGlobalSpanCostCoefficient(100)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.FromMilliseconds(max(1, int(time_budget_ms)))

    assignment = routing.SolveWithParameters(params)
    if assignment is None:
        return None

    routes = []
    for vehicle in range(vehicle_count):
        order = []
        index = routing.Start(vehicle)
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != depot:
                order.append(node)
            index = assignment.Value(routing.NextVar(index))
        routes.append(order)
    return routes


# ---------------------------------------------------------------------- PyVRP


def solve_pyvrp(distances, durations, vehicle_count, depot, round_trip,
                objective, time_budget_ms):
    """
    PyVRP: hybrid genetic search. Slower than the others and usually better,
    which is why it is offered as "best quality" rather than as a default.
    """
    node_count = len(distances)
    cost = open_route_matrix(distances, depot) if not round_trip else distances

    # PyVRP numbers clients 0..k-1 in the order they were added, independent of
    # matrix indices. Keeping the mapping explicit means the depot does not have
    # to be index 0 for the result to be read back correctly.
    client_nodes = [i for i in range(node_count) if i != depot]

    def solve_once(cap, budget_ms):
        model = pyvrp.Model()
        locations = [model.add_location(x=0, y=i) for i in range(node_count)]
        depot_obj = model.add_depot(location=locations[depot])
        for node in client_nodes:
            model.add_client(location=locations[node])

        profile = model.add_profile()
        vehicle_kwargs = {}
        if cap is not None:
            vehicle_kwargs["max_distance"] = max(1, int(cap))
        for _ in range(vehicle_count):
            model.add_vehicle_type(
                1,
                start_depot=depot_obj,
                end_depot=depot_obj,
                profile=profile,
                **vehicle_kwargs,
            )

        for i in range(node_count):
            for j in range(node_count):
                if i == j:
                    continue
                model.add_edge(
                    locations[i],
                    locations[j],
                    distance=int(round(cost[i][j] * SCALE)),
                    duration=int(round(durations[i][j])),
                    profile=profile,
                )

        with warnings.catch_warnings():
            # PyVRP warns when it cannot find a feasible solution. During the
            # cap search that is not a fault, it is the answer to the question
            # being asked — "is this cap achievable?" — and it happens on
            # roughly half the probes by design. Logging it would train an
            # operator to ignore the warning that matters.
            warnings.simplefilter("ignore")
            result = model.solve(
                stop=MaxRuntime(max(0.05, budget_ms / 1000)),
                display=False,
            )
        if result is None or not result.is_feasible():
            return None

        routes = []
        for route in result.best.routes():
            # is_client is a method, not a property: truth-testing the bound
            # method instead of calling it silently accepts every activity,
            # depots included, and corrupts the assignment.
            routes.append([client_nodes[a.idx] for a in route if a.is_client()])
        # Pad so an unused vehicle still has a row; the app relies on one route
        # per vehicle to say "2 of 3 vans used".
        while len(routes) < vehicle_count:
            routes.append([])
        return routes[:vehicle_count]

    if objective == "balanced":
        return balanced_cap_search(
            solve_once, distances, depot, round_trip, vehicle_count, time_budget_ms
        )
    return solve_once(None, time_budget_ms)


# ---------------------------------------------------------------------- VROOM


def solve_vroom(distances, durations, vehicle_count, depot, round_trip,
                objective, time_budget_ms):
    """
    VROOM: fast local search. Picked for latency rather than route quality.

    It has no time budget knob — it runs an exploration level to completion and
    returns. The budget is therefore not passed to it; the app's own request
    timeout is what bounds it.
    """
    node_count = len(distances)
    cost = open_route_matrix(distances, depot) if not round_trip else distances
    integer_cost = [[int(round(v * SCALE)) for v in row] for row in cost]

    def solve_once(cap, _budget_ms):
        problem = vroom.Input()
        # VROOM optimises the *durations* matrix. Feeding it distances is what
        # makes it minimise distance, which is what every other engine here does
        # and what the app's totals are computed from. The real durations matrix
        # is not used: with no time windows in v1 it constrains nothing, and
        # letting the engines disagree about what they optimise would make the
        # comparison table meaningless.
        problem.set_durations_matrix(profile="car", matrix_input=integer_cost)
        # Set separately so a max_distance cap is expressed in the same units.
        problem.set_distances_matrix(profile="car", matrix_input=integer_cost)

        for v in range(vehicle_count):
            kwargs = {}
            if cap is not None:
                kwargs["max_distance"] = max(1, int(cap))
            problem.add_vehicle(
                vroom.Vehicle(v + 1, start=depot, end=depot, profile="car", **kwargs)
            )

        for node in range(node_count):
            if node != depot:
                problem.add_job(vroom.Job(id=node, location=node))

        solution = problem.solve(exploration_level=5, nb_threads=2)
        if solution is None or solution.summary.unassigned > 0:
            # A cap too tight to serve every stop leaves jobs unassigned. That
            # is a failed attempt, not a plan: returning it would drop
            # deliveries silently.
            return None

        frame = solution.routes
        routes = [[] for _ in range(vehicle_count)]
        for vehicle_id, kind, location in zip(
            frame["vehicle_id"], frame["type"], frame["location_index"]
        ):
            if kind != "job":
                continue
            slot = int(vehicle_id) - 1
            if 0 <= slot < vehicle_count:
                routes[slot].append(int(location))
        return routes

    if objective == "balanced":
        return balanced_cap_search(
            solve_once, distances, depot, round_trip, vehicle_count, time_budget_ms
        )
    return solve_once(None, time_budget_ms)


ENGINES = {
    "ortools": solve_ortools,
    "pyvrp": solve_pyvrp,
    "vroom": solve_vroom,
}


# ------------------------------------------------------------------------ http


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quieter than the default access log
        sys.stderr.write("[sidecar] %s\n" % (fmt % args))

    def _authorised(self):
        """Constant-time comparison; a token check that leaks timing is theatre."""
        if not SIDECAR_TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        return hmac.compare_digest(header[len(prefix):], SIDECAR_TOKEN)

    def do_GET(self):
        if self.path == "/health":
            # Which engines actually loaded, not which ones exist in the source.
            # An image built before an engine was added reports it missing here,
            # which is the difference between "redeploy the sidecar" and an
            # afternoon spent looking at the app.
            self._send(200, {
                "status": "ok",
                "engines": {n: engine_available(n) for n in ENGINES},
                "unavailable": ENGINE_IMPORT_ERROR,
            })
        else:
            self._send(404, {"error": {"code": "NOT_FOUND", "message": "No such path."}})

    def do_POST(self):
        if not self._authorised():
            self._send(401, {"error": {"code": "UNAUTHORISED",
                                       "message": "Missing or invalid token."}})
            return

        if self.path != "/solve":
            self._send(404, {"error": {"code": "NOT_FOUND", "message": "No such path."}})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            self._send(400, {"error": {"code": "INVALID_REQUEST",
                                       "message": "Body is not valid JSON."}})
            return

        try:
            distances = payload["distances"]
            durations = payload.get("durations", distances)
            vehicle_count = int(payload["vehicleCount"])
            round_trip = bool(payload.get("roundTrip", True))
            objective = payload.get("objective", "balanced")
            time_budget_ms = int(payload.get("timeBudgetMs", 10_000))
            # Defaulted, not required: deployments of the app that predate the
            # other two engines send no engine field and mean OR-Tools.
            engine = payload.get("engine", "ortools")
        except (KeyError, TypeError, ValueError):
            self._send(400, {"error": {"code": "INVALID_REQUEST",
                                       "message": "Missing distances or vehicleCount."}})
            return

        if engine not in ENGINES:
            self._send(400, {"error": {"code": "UNKNOWN_SOLVER",
                                       "message": f"No engine named {engine!r}."}})
            return

        if not engine_available(engine):
            self._send(503, {"error": {
                "code": "ENGINE_UNAVAILABLE",
                "message": f"{engine} is not installed in this build of the solver service.",
                "detail": ENGINE_IMPORT_ERROR.get(engine),
            }})
            return

        node_count = len(distances)
        if node_count < 2:
            self._send(400, {"error": {"code": "INVALID_REQUEST",
                                       "message": "Need a depot and at least one stop."}})
            return
        if node_count > MAX_NODES:
            self._send(413, {"error": {"code": "TOO_MANY_STOPS",
                                       "message": f"This engine handles up to {MAX_NODES - 1} stops."}})
            return
        if vehicle_count < 1:
            self._send(400, {"error": {"code": "INVALID_REQUEST",
                                       "message": "Need at least one vehicle."}})
            return

        budget = max(1, min(time_budget_ms, MAX_TIME_BUDGET_MS))

        started = time.perf_counter()
        try:
            routes = ENGINES[engine](distances, durations, vehicle_count, 0,
                                     round_trip, objective, budget)
        except Exception as exc:  # noqa: BLE001 - report, do not crash the sidecar
            sys.stderr.write("[sidecar] %s solve failed: %r\n" % (engine, exc))
            self._send(500, {"error": {"code": "SOLVER_FAILED",
                                       "message": "The engine could not plan this."}})
            return

        elapsed_ms = int((time.perf_counter() - started) * 1000)

        if routes is None:
            self._send(422, {"error": {"code": "INFEASIBLE",
                                       "message": "No plan satisfies these constraints."}})
            return

        self._send(200, {"routes": routes, "solveTimeMs": elapsed_ms,
                         "engine": engine})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True

    def shutdown(_signum, _frame):
        sys.stderr.write("[sidecar] shutting down\n")
        # From another thread, deliberately.
        #
        # shutdown() blocks until serve_forever() has returned, and a signal
        # handler runs *in* the main thread — the one sitting inside
        # serve_forever(). Calling it directly deadlocks: the loop cannot exit
        # because the thread that would exit it is waiting for it to exit.
        #
        # The symptom is a process that ignores SIGTERM entirely and has to be
        # SIGKILLed. On Cloud Run that means every scale-down waits out the
        # 10-second grace period and then dies mid-request, dropping whatever
        # solve was in flight instead of finishing it.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    ready = [n for n in ENGINES if engine_available(n)]
    if not ready:
        # Every engine failed to import. Serving health checks while refusing
        # every solve looks like a working deployment; it is not one.
        sys.stderr.write(
            "[sidecar] no engines available: %s\n" % (ENGINE_IMPORT_ERROR,)
        )
        raise SystemExit(1)

    mode = "token required" if SIDECAR_TOKEN else "NO AUTH (private network only)"
    sys.stderr.write(
        "[sidecar] listening on http://%s:%d — %s, max budget %dms\n"
        % (HOST, PORT, mode, MAX_TIME_BUDGET_MS)
    )
    sys.stderr.write("[sidecar] engines: %s\n" % ", ".join(ready))
    for name, err in ENGINE_IMPORT_ERROR.items():
        sys.stderr.write("[sidecar] %s unavailable: %s\n" % (name, err))
    server.serve_forever()


if __name__ == "__main__":
    main()

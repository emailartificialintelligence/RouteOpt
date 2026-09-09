"""
OR-Tools solving sidecar for RoutePlan.

Why a separate process: OR-Tools is a C++ library with Python bindings and no
usable JavaScript build. Rather than compromise the engine, it runs beside the
app and speaks a small JSON protocol over HTTP.

The protocol is deliberately narrow. This service receives a problem and a
distance matrix and returns *only the assignment* — which stops each vehicle
visits, in order. It does not compute arrival times, leg distances or totals.
All of that is arithmetic the TypeScript side already does for the built-in
engine, and duplicating it here in another language is how two solvers end up
quietly disagreeing about the same route.

Run it:

    pip install ortools
    python sidecar/solver.py            # listens on 127.0.0.1:8081

Then point the app at it:

    ORTOOLS_URL=http://127.0.0.1:8081

Bind to localhost only. This endpoint does real CPU work on unvalidated input
and has no authentication; it is not meant to face the internet.
"""

from __future__ import annotations

import hmac
import json
import os
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
except ImportError:  # pragma: no cover - import guard, not logic
    sys.stderr.write(
        "ortools is not installed. Run:  pip install ortools\n"
    )
    raise SystemExit(1)


HOST = os.environ.get("ORTOOLS_HOST", "127.0.0.1")
PORT = int(os.environ.get("ORTOOLS_PORT", "8081"))

# Shared secret.
#
# On a single VM this service sits on a private network and needs no auth. Hosted
# on its own — beside a Vercel app, say — it is on the public internet, and it
# will happily spend seconds of CPU on any request that arrives. Set
# ORTOOLS_TOKEN there and the app sends it as a bearer token.
#
# Empty means no check, which is correct for the private-network case and wrong
# for anything reachable from outside. The startup log says which mode it is in
# so nobody discovers it from a bill.
ORTOOLS_TOKEN = os.environ.get("ORTOOLS_TOKEN", "").strip()

# A matrix bigger than this means something upstream is wrong; refuse rather
# than spend minutes on it.
MAX_NODES = 250
# Hard ceiling regardless of what the caller asks for, so one request cannot
# occupy the process indefinitely.
MAX_TIME_BUDGET_MS = 60_000

# OR-Tools works in integers. Distances arrive in metres and may be floats.
SCALE = 1


def solve_vrp(distances, durations, vehicle_count, depot, round_trip, objective,
              time_budget_ms):
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
    budget = max(1, min(int(time_budget_ms), MAX_TIME_BUDGET_MS))
    params.time_limit.FromMilliseconds(budget)

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
        sys.stderr.write("[ortools] %s\n" % (fmt % args))

    def _authorised(self):
        """Constant-time comparison; a token check that leaks timing is theatre."""
        if not ORTOOLS_TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        return hmac.compare_digest(header[len(prefix):], ORTOOLS_TOKEN)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "engine": "ortools"})
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
        except (KeyError, TypeError, ValueError):
            self._send(400, {"error": {"code": "INVALID_REQUEST",
                                       "message": "Missing distances or vehicleCount."}})
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

        started = time.perf_counter()
        try:
            routes = solve_vrp(distances, durations, vehicle_count, 0,
                               round_trip, objective, time_budget_ms)
        except Exception as exc:  # noqa: BLE001 - report, do not crash the sidecar
            sys.stderr.write("[ortools] solve failed: %r\n" % (exc,))
            self._send(500, {"error": {"code": "SOLVER_FAILED",
                                       "message": "The engine could not plan this."}})
            return

        elapsed_ms = int((time.perf_counter() - started) * 1000)

        if routes is None:
            self._send(422, {"error": {"code": "INFEASIBLE",
                                       "message": "No plan satisfies these constraints."}})
            return

        self._send(200, {"routes": routes, "solveTimeMs": elapsed_ms})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True

    def shutdown(_signum, _frame):
        sys.stderr.write("[ortools] shutting down\n")
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    mode = "token required" if ORTOOLS_TOKEN else "NO AUTH (private network only)"
    sys.stderr.write("[ortools] listening on http://%s:%d — %s\n" % (HOST, PORT, mode))
    server.serve_forever()


if __name__ == "__main__":
    main()

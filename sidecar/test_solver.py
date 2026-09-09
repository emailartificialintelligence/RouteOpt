"""
Tests for the sidecar's own arithmetic.

Deliberately dependency-free: plain unittest, no pytest, no engines required.
The engines themselves are third-party and tested upstream; what is worth
testing here is the code this project wrote around them — the leg arithmetic
that steers the balanced objective, and the cap search that turns a min-sum
solver into an approximate min-max one.

    python sidecar/test_solver.py
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import solver  # noqa: E402


# A small asymmetric-enough matrix. Index 0 is the depot.
D = [
    [0, 10, 20, 30],
    [10, 0, 12, 25],
    [20, 12, 0, 15],
    [30, 25, 15, 0],
]


class RouteDistance(unittest.TestCase):
    def test_round_trip_pays_for_going_home(self):
        # 0->1->2->0
        self.assertEqual(solver.route_distance([1, 2], D, 0, True), 10 + 12 + 20)

    def test_open_route_stops_at_the_last_delivery(self):
        self.assertEqual(solver.route_distance([1, 2], D, 0, False), 10 + 12)

    def test_an_idle_vehicle_drives_nothing(self):
        self.assertEqual(solver.route_distance([], D, 0, True), 0)
        self.assertEqual(solver.route_distance([], D, 0, False), 0)

    def test_single_stop_round_trip_goes_out_and_back(self):
        self.assertEqual(solver.route_distance([3], D, 0, True), 30 + 30)


class LongestRoute(unittest.TestCase):
    def test_reports_the_worst_vehicle_not_the_total(self):
        routes = [[1], [2, 3]]
        self.assertEqual(
            solver.longest_route(routes, D, 0, True),
            max(
                solver.route_distance([1], D, 0, True),
                solver.route_distance([2, 3], D, 0, True),
            ),
        )

    def test_no_routes_is_zero_rather_than_an_error(self):
        self.assertEqual(solver.longest_route([], D, 0, True), 0)


class OpenRouteMatrix(unittest.TestCase):
    def test_returning_to_the_depot_becomes_free(self):
        out = solver.open_route_matrix(D, 0)
        for row in out:
            self.assertEqual(row[0], 0)

    def test_every_other_leg_is_untouched(self):
        out = solver.open_route_matrix(D, 0)
        for i in range(len(D)):
            for j in range(1, len(D)):
                self.assertEqual(out[i][j], D[i][j])

    def test_does_not_mutate_the_caller_s_matrix(self):
        # The same matrix is reused across the cap search's probes. Mutating it
        # would make every probe after the first solve a different problem.
        original = [row[:] for row in D]
        solver.open_route_matrix(D, 0)
        self.assertEqual(D, original)


class BalancedCapSearch(unittest.TestCase):
    """
    A stand-in engine: it splits stops evenly into `vehicle_count` chunks and
    refuses any cap it cannot meet. That is enough to exercise the search
    without a real solver, and it makes the assertions deterministic.
    """

    def _engine(self, distances, vehicle_count, round_trip, calls):
        stops = list(range(1, len(distances)))

        def solve_once(cap, budget_ms):
            calls.append(cap)
            # Try progressively more even splits until one meets the cap.
            for parts in range(1, vehicle_count + 1):
                routes = [stops[i::parts] for i in range(parts)]
                routes += [[] for _ in range(vehicle_count - parts)]
                longest = solver.longest_route(routes, distances, 0, round_trip)
                if cap is None or longest <= cap:
                    return routes
            return None

        return solve_once

    def test_beats_the_uncapped_plan_it_starts_from(self):
        calls = []
        once = self._engine(D, 2, True, calls)
        uncapped = once(None, 1)
        best = solver.balanced_cap_search(once, D, 0, True, 2, 4000)

        self.assertLessEqual(
            solver.longest_route(best, D, 0, True),
            solver.longest_route(uncapped, D, 0, True),
        )

    def test_serves_every_stop_exactly_once(self):
        # The whole point of the search is that it may reject a plan. It must
        # never return one of the rejects.
        calls = []
        once = self._engine(D, 2, True, calls)
        best = solver.balanced_cap_search(once, D, 0, True, 2, 4000)
        served = sorted(s for route in best for s in route)
        self.assertEqual(served, [1, 2, 3])

    def test_probes_below_the_uncapped_longest(self):
        calls = []
        once = self._engine(D, 2, True, calls)
        uncapped_longest = solver.longest_route(once(None, 1), D, 0, True)
        calls.clear()
        solver.balanced_cap_search(once, D, 0, True, 2, 4000)
        probed = [c for c in calls if c is not None]
        self.assertTrue(probed, "search made no capped probe at all")
        self.assertTrue(min(probed) < uncapped_longest)

    def test_gives_up_rather_than_looping_when_nothing_is_feasible(self):
        calls = []

        def always_fails(cap, budget_ms):
            calls.append(cap)
            return None if cap is not None else [[1, 2, 3], []]

        best = solver.balanced_cap_search(always_fails, D, 0, True, 2, 4000)
        # Falls back to the uncapped plan rather than returning nothing.
        self.assertEqual(sorted(s for r in best for s in r), [1, 2, 3])
        # And stops probing; it does not spin.
        self.assertLessEqual(len(calls), 6)

    def test_returns_none_when_even_the_first_solve_fails(self):
        # An engine that cannot solve at all is infeasible, not "balanced".
        self.assertIsNone(
            solver.balanced_cap_search(
                lambda cap, budget: None, D, 0, True, 2, 1000
            )
        )

    def test_never_asks_for_a_zero_or_negative_budget(self):
        budgets = []

        def record(cap, budget_ms):
            budgets.append(budget_ms)
            return [[1, 2, 3], []]

        solver.balanced_cap_search(record, D, 0, True, 2, 10)
        self.assertTrue(all(b >= 1 for b in budgets), budgets)


if __name__ == "__main__":
    unittest.main(verbosity=2)

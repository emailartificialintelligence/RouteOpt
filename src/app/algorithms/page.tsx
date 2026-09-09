import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { RouteShapeComparison } from "@/components/site/RouteShapeComparison";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "Algorithms — RoutePlan",
  description:
    "Why the solver clusters before it sequences, what 2-opt and Or-opt do, and how OR-Tools compares. With measured numbers.",
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

export default function AlgorithmsPage() {
  return (
    <SiteShell>
      <article className={styles.prose}>
        <h1 className={styles.pageTitle}>Algorithms</h1>
        <p className={styles.lede}>
          What actually happens between pressing <em>Plan routes</em> and seeing
          lines on a map — and why some of the decisions are about how a plan
          looks rather than how short it is.
        </p>

        <h2>The problem</h2>
        <p>
          This is a vehicle routing problem: given a depot, a set of stops and a
          number of vehicles, decide which vehicle visits which stops, and in
          what order, to minimise something you care about. It is NP-hard, so
          for anything past a handful of stops nobody computes the true optimum.
          Twenty stops on three vans is already more arrangements than there are
          atoms in the observable universe.
        </p>
        <p>
          What good solvers do instead is find a very good answer quickly, and
          be honest that it is not provably the best one.
        </p>

        <h2>Step one: the distance matrix</h2>
        <p>
          Before any routing, the app needs the distance and time between every
          pair of points. That is the real cost and the real bottleneck — not the
          solver. Forty stops means 41 × 41, or 1,681 pairs.
        </p>
        <p>
          These come from OSRM, using actual road networks. If OSRM is
          unreachable the app falls back to straight-line distance with a 1.3×
          correction for the fact that roads are not straight, and says so in the
          interface. A plan with approximate distances beats no plan, as long as
          nobody is misled about which they are looking at.
        </p>

        <h2>Step two: cluster first, then sequence</h2>
        <p>
          Here is the decision that shapes everything else. The obvious approach
          is one nearest-neighbour sweep across all the stops, opening a new
          vehicle each time the current one fills. It produces short routes and
          it looks broken.
        </p>

        <RouteShapeComparison />

        <p>
          Both panels are the same forty stops on three vans, generated from real
          data. On the left the vans interleave and cover each other&apos;s
          ground; on the right each keeps to its own area. Users read
          overlapping routes as a malfunction, and they are not entirely wrong —
          two drivers on the same street is waste.
        </p>
        <p>So the solver does it the other way round:</p>
        <ol>
          <li>
            <strong>Partition</strong> the stops into geographic clusters, one
            per vehicle.
          </li>
          <li>
            <strong>Sequence</strong> each cluster independently into a good
            route.
          </li>
        </ol>
        <p>
          Clustering uses k-means, on coordinates projected into local metres
          rather than raw latitude and longitude. That projection matters: a
          degree of longitude is 111 km at the equator and 71 km in Paris, so
          clustering raw coordinates produces clusters stretched east-west for no
          geographic reason.
        </p>
        <p>
          Under <em>even workload</em> the clusters are size-constrained. Points
          are assigned in order of <em>regret</em> — the gap between their
          nearest and second-nearest cluster — so a stop that strongly prefers
          one van gets first refusal, and stops that barely care absorb the
          imbalance.
        </p>

        <h2>Step three: sequencing each route</h2>
        <p>Three passes, each cheap, each fixing what the last one leaves:</p>
        <ol>
          <li>
            <strong>Nearest neighbour</strong> builds a first route by always
            driving to the closest unvisited stop. Fast, and usually 20–25%
            worse than optimal — it paints itself into corners.
          </li>
          <li>
            <strong>2-opt</strong> repeatedly takes two edges, reverses the
            segment between them, and keeps the change if the route got shorter.
            This is what removes a route crossing itself.
          </li>
          <li>
            <strong>Or-opt</strong> lifts runs of one to three consecutive stops
            and reinserts them elsewhere. It catches improvements 2-opt cannot,
            and unlike 2-opt it stays valid when the matrix is asymmetric — which
            road networks are, wherever there are one-way systems.
          </li>
        </ol>

        <div className={styles.aside}>
          The whole pipeline is deterministic. The same stops always produce the
          same plan, because a dispatcher who re-runs a plan and gets different
          routes stops trusting it — even when both are equally good.
        </div>

        <h2>The second engine: OR-Tools</h2>
        <p>
          The built-in engine is a heuristic that returns in milliseconds.
          Google&apos;s OR-Tools takes a different approach: build a first
          solution, then spend a fixed time budget on guided local search,
          escaping local optima by penalising features that keep reappearing in
          bad solutions.
        </p>
        <p>
          It runs as a separate process, because OR-Tools is a C++ library with
          Python bindings and no usable JavaScript build. Measured on the same
          forty stops and three vans, with real road distances:
        </p>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Engine</th>
              <th>Objective</th>
              <th>Total</th>
              <th>Longest</th>
              <th>Vans</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Fast</td>
              <td>even workload</td>
              <td>90.0 km</td>
              <td>32.1 km</td>
              <td>3</td>
              <td>7 ms</td>
            </tr>
            <tr>
              <td>Fast</td>
              <td>shortest total</td>
              <td>90.9 km</td>
              <td>35.6 km</td>
              <td>3</td>
              <td>2 ms</td>
            </tr>
            <tr>
              <td>Balanced</td>
              <td>even workload</td>
              <td>90.6 km</td>
              <td>30.3 km</td>
              <td>3</td>
              <td>5.0 s</td>
            </tr>
            <tr>
              <td>Balanced</td>
              <td>shortest total</td>
              <td>76.0 km</td>
              <td>76.0 km</td>
              <td>1</td>
              <td>5.0 s</td>
            </tr>
          </tbody>
        </table>

        <p>
          Read the last row carefully. Asked for the shortest total, OR-Tools
          found a 76 km answer the fast engine cannot see — 16% better — by
          putting every stop on one van and leaving two idle. That is the
          correct answer to the question asked. Whether it is the answer you
          wanted is why the objective is a control and not a default.
        </p>
        <p>
          For comparison, visiting those forty stops in the order they were
          pasted is 266 km.
        </p>

        <h2>The engines</h2>
        <p>
          Four engines exist in the registry. Two are built; two are named so
          the selector can say what is coming rather than showing a dead control
          with no explanation. Which are actually available depends on how this
          instance is configured — ask{" "}
          <code>GET /api/v1/solve</code> and it will tell you.
        </p>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Engine</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th style={{ textAlign: "left" }}>What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Fast</strong>
                <br />
                <code>greedy</code>
              </td>
              <td style={{ textAlign: "left" }}>
                <strong>Active.</strong> Always available — no setup, no
                dependencies.
              </td>
              <td style={{ textAlign: "left" }}>
                Cluster-first, then nearest neighbour with 2-opt and Or-opt, as
                described above. Returns in milliseconds.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Balanced</strong>
                <br />
                <code>ortools</code>
              </td>
              <td style={{ textAlign: "left" }}>
                <strong>Built, needs a sidecar.</strong> Active only where
                <code>ORTOOLS_URL</code> is set. Off on this deployment.
              </td>
              <td style={{ textAlign: "left" }}>
                Google OR-Tools with guided local search, in a Python process
                beside the app. Found 16% shorter routes on the test above, and
                took about a thousand times longer to do it.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Best quality</strong>
                <br />
                <code>pyvrp</code>
              </td>
              <td style={{ textAlign: "left" }}>
                <strong>Not built.</strong> Listed as coming soon.
              </td>
              <td style={{ textAlign: "left" }}>
                Hybrid genetic search. The strongest routes available for this
                class of problem, given a longer time budget.
              </td>
            </tr>
            <tr>
              <td>
                <strong>VRoom</strong>
                <br />
                <code>vroom</code>
              </td>
              <td style={{ textAlign: "left" }}>
                <strong>Not built.</strong> Listed as coming soon.
              </td>
              <td style={{ textAlign: "left" }}>
                A lightweight open-source engine, quick on mid-sized problems.
              </td>
            </tr>
          </tbody>
        </table>

        <div className={styles.aside}>
          Adding an engine is a file and a registry entry — every one implements
          the same <code>solve(problem, matrix)</code> interface, and the leg
          arithmetic, arrival times and totals are shared. That is what makes
          the comparison honest: a difference in the table means a difference in
          routing, not two implementations disagreeing about how to add up
          minutes.
        </div>

        <h2>What is deliberately not modelled</h2>
        <ul>
          <li>
            <strong>Time windows.</strong> The data format carries the field;
            the solvers ignore it.
          </li>
          <li>
            <strong>Vehicle capacity.</strong> Same.
          </li>
          <li>
            <strong>Traffic.</strong> Distances are free-flow. A round planned
            for rush hour will run long.
          </li>
          <li>
            <strong>Service time is uniform</strong> unless you set it per stop —
            five minutes by default, which is the single number that most affects
            whether a plan survives contact with the day.
          </li>
        </ul>

        <p style={{ marginTop: 28 }}>
          <Link href="/plan" className={styles.ctaLarge}>
            Try it
          </Link>{" "}
          <Link href="/api-docs" className={styles.ctaGhost}>
            Or call the API
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}

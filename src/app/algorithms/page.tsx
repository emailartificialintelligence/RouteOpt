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

        <h2>The other three engines</h2>
        <p>
          The built-in engine is a heuristic that returns in milliseconds. The
          other three take a different approach: build a first solution, then
          spend a time budget improving it — OR-Tools with guided local search,
          PyVRP with a genetic algorithm, VROOM with its own local search.
        </p>
        <p>
          All three run in a separate process, because all three are C++
          libraries with Python bindings and no usable JavaScript build. They
          share one service, so choosing between them is a dropdown rather than
          a deployment.
        </p>
        <p>
          Measured on forty stops and three vans, with real road distances.
          Visiting those forty stops in the order they were pasted is 344&nbsp;km,
          which is the number every row below is an improvement on.
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
              <td>101.4 km</td>
              <td>36.5 km</td>
              <td>3</td>
              <td>12 ms</td>
            </tr>
            <tr>
              <td>Fast</td>
              <td>shortest total</td>
              <td>92.1 km</td>
              <td>37.1 km</td>
              <td>3</td>
              <td>8 ms</td>
            </tr>
            <tr>
              <td>Balanced</td>
              <td>even workload</td>
              <td>97.7 km</td>
              <td>33.6 km</td>
              <td>3</td>
              <td>5.2 s</td>
            </tr>
            <tr>
              <td>Balanced</td>
              <td>shortest total</td>
              <td>78.8 km</td>
              <td>78.8 km</td>
              <td>1</td>
              <td>5.2 s</td>
            </tr>
            <tr>
              <td>Best quality</td>
              <td>even workload</td>
              <td>92.6 km</td>
              <td>32.0 km</td>
              <td>3</td>
              <td>9.2 s</td>
            </tr>
            <tr>
              <td>Best quality</td>
              <td>shortest total</td>
              <td>77.9 km</td>
              <td>77.9 km</td>
              <td>1</td>
              <td>9.1 s</td>
            </tr>
            <tr>
              <td>VRoom</td>
              <td>even workload</td>
              <td>92.6 km</td>
              <td>32.0 km</td>
              <td>3</td>
              <td>1.7 s</td>
            </tr>
            <tr>
              <td>VRoom</td>
              <td>shortest total</td>
              <td>77.9 km</td>
              <td>77.9 km</td>
              <td>1</td>
              <td>239 ms</td>
            </tr>
          </tbody>
        </table>

        <p>
          Three things in that table are worth reading slowly.
        </p>
        <p>
          <strong>The single-van rows are not a bug.</strong> Asked for the
          shortest total, three of the four engines put every stop on one van
          and leave two idle. That genuinely is the shortest total — a second
          van means a second trip out to the round and back — and it is the
          correct answer to the question asked. Whether it is the answer you
          wanted is why the objective is a control and not a default.
        </p>
        <p>
          <strong>VRoom and Best quality returned identical plans</strong>, and
          VRoom did it between five and thirty-eight times faster. Two engines
          agreeing to the metre is not suspicious here — on a problem this size
          they are both reaching the same answer, and the gap is in how long
          they take to be sure of it.
        </p>
        <p>
          <strong>Balanced is beaten on its own objective.</strong> OR-Tools is
          the only one of the three with a real min-max objective, and it still
          finishes third on <em>even workload</em>: 33.6&nbsp;km against
          32.0&nbsp;km. Optimising the right objective directly does not
          guarantee a better answer than approximating it with a stronger
          underlying search. The next section is about why.
        </p>

        <h2>The engines</h2>
        <p>
          Four engines, all built. One runs inside the app; the other three run
          in a solver service beside it, because OR-Tools, PyVRP and VROOM are
          C++ libraries with no usable JavaScript build. They share one service
          and one protocol, so which of them you pick is a dropdown rather than
          a deployment. Whether that service is configured here decides which
          are actually offered — ask <code>GET /api/v1/solve</code> and it will
          tell you.
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
                <strong>Active where the solver service is set up.</strong>{" "}
                Needs <code>SIDECAR_URL</code>.
              </td>
              <td style={{ textAlign: "left" }}>
                Google OR-Tools with guided local search, in a Python process
                beside the app. The only engine here with a real min-max
                objective, which is what &ldquo;even workload&rdquo; asks for.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Best quality</strong>
                <br />
                <code>pyvrp</code>
              </td>
              <td style={{ textAlign: "left" }}>
                <strong>Active where the solver service is set up.</strong>{" "}
                Needs <code>SIDECAR_URL</code>.
              </td>
              <td style={{ textAlign: "left" }}>
                Hybrid genetic search. The strongest routes available for this
                class of problem, given a longer time budget — which is why it
                is given the largest one.
              </td>
            </tr>
            <tr>
              <td>
                <strong>VRoom</strong>
                <br />
                <code>vroom</code>
              </td>
              <td style={{ textAlign: "left" }}>
                <strong>Active where the solver service is set up.</strong>{" "}
                Needs <code>SIDECAR_URL</code>.
              </td>
              <td style={{ textAlign: "left" }}>
                A lightweight open-source engine, and the surprise of the
                benchmark above: identical plans to PyVRP on both objectives,
                between five and thirty-eight times faster, and better than
                OR-Tools on both.
              </td>
            </tr>
          </tbody>
        </table>

        <h3>How &ldquo;even workload&rdquo; is enforced</h3>
        <p>
          The two objectives are not equally easy to ask for. &ldquo;Shortest
          total&rdquo; is what every one of these engines optimises natively.
          &ldquo;Even workload&rdquo; — minimising the <em>longest</em> route
          rather than the sum — is a different objective, and only OR-Tools
          supports it directly, through a span cost on its distance dimension.
        </p>
        <p>
          Left alone on a round trip, PyVRP and VROOM do the arithmetically
          correct and operationally useless thing: they put every stop on one
          vehicle, because a second van means a second trip out to the round and
          back. On a 40-stop test that is one driver covering 239&nbsp;km while
          three vans sit idle.
        </p>
        <p>
          Both accept a per-vehicle distance cap, so minimising the longest route
          becomes a search for the smallest cap that still admits a plan — a
          binary search bounded below by a perfectly even split and above by the
          uncapped answer. Four probes gets within a few percent, at the price of
          four solves instead of one.
        </p>
        <p>
          That price is why VROOM takes 1.7&nbsp;s on <em>even workload</em> and
          239&nbsp;ms on <em>shortest total</em> in the table above. It is not a
          slower engine on the harder objective; it is the same engine run
          several times.
        </p>
        <p>
          The surprise is that the approximation wins. OR-Tools optimises the
          real min-max objective and lands on 33.6&nbsp;km; the two engines
          bolting a cap search onto a min-sum solver land on 32.0&nbsp;km. A
          span cost is the more principled formulation, but it is solved by a
          weaker search than PyVRP&rsquo;s genetic algorithm, and on this
          instance the search matters more than the formulation. That is worth
          knowing rather than smoothing over: it is a result about these
          engines on this problem size, not a general claim about either
          technique.
        </p>

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

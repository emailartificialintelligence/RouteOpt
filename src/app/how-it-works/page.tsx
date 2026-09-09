import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { MAX_STOPS } from "@/lib/schema";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "How it works — RoutePlan",
  description:
    "Paste addresses, confirm the pins, plan routes, and send each driver a link. Five steps, about two minutes.",
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

export default function HowItWorksPage() {
  return (
    <SiteShell>
      <article className={styles.prose}>
        <h1 className={styles.pageTitle}>How it works</h1>
        <p className={styles.lede}>
          Five steps, about two minutes for a forty-stop round. Nothing to
          install and nothing to sign up for.
        </p>

        <h2>1. Set the depot</h2>
        <p>
          Where the vans start. Type an address and press <strong>Find</strong>,
          or click <strong>Place on map</strong> and drop it exactly where the
          yard gate is. Coordinates work too — paste{" "}
          <code>48.8443, 2.3743</code> and it is taken literally, no lookup.
        </p>

        <h2>2. Add your stops</h2>
        <p>Three ways in, whichever suits what you already have:</p>
        <ul>
          <li>
            <strong>Paste a list.</strong> One address per line. Numbering and
            bullets pasted from a document are stripped automatically.
          </li>
          <li>
            <strong>Upload a CSV.</strong> Either <code>label,address</code> or{" "}
            <code>label,lat,lng</code>. A header row is detected and skipped, and
            a file that mixes both kinds of row is fine.
          </li>
          <li>
            <strong>Click the map.</strong> For the stop with no useful address —
            the loading bay round the back, the site entrance off the lane.
          </li>
        </ul>
        <p>
          Up to {MAX_STOPS} stops in one plan. Duplicates are kept, because two
          deliveries to the same building is normal and quietly merging them
          would lose a job.
        </p>

        <h2>3. Check every pin</h2>
        <p>
          This is the step worth your attention, and the reason the tool makes
          you look. A geocoder never refuses: ask it for a street it has no data
          for and it hands back the town centre, or the middle of the country,
          with no error attached. The route that follows looks perfectly
          plausible and sends a driver to the wrong place.
        </p>
        <p>So every match is graded, and anything doubtful is flagged:</p>
        <ul>
          <li>
            <strong>Nothing shown</strong> — one clear match at a real address.
          </li>
          <li>
            <strong>Check</strong> — several places matched, or only an area did.
            Click the stop to see the alternatives and pick the right one.
          </li>
          <li>
            <strong>No match</strong> — nothing was found. Fix the spelling, add
            a postcode, or place it on the map by hand. The plan will not run
            until every stop has a pin.
          </li>
        </ul>
        <p>
          Every stop shows its coordinates to five decimal places, about a
          metre, so a pin that has drifted is visible without leaving the list.
        </p>

        <h2>4. Plan</h2>
        <p>Three choices, then press the button:</p>
        <ul>
          <li>
            <strong>Vehicles</strong> — how many are going out.
          </li>
          <li>
            <strong>Even workload</strong> gives everyone a similar day.{" "}
            <strong>Shortest total</strong> buys fewer kilometres overall and
            will happily leave one van idle. Both are real: on a forty-stop test
            the difference was 15 km of total distance against a much more
            lopsided split.
          </li>
          <li>
            <strong>Return to the depot</strong> — off if drivers finish at their
            last stop.
          </li>
        </ul>

        <h2>5. Send it out</h2>
        <ul>
          <li>
            <strong>Google Maps link</strong> per driver, straight to their
            phone. If a route is too long for one link the app says exactly how
            many stops were left off, rather than quietly truncating it.
          </li>
          <li>
            <strong>Printed manifest</strong> — every van, stops in order, with
            arrival times.
          </li>
          <li>
            <strong>Share link</strong> — a read-only copy of the whole plan. No
            account needed to open it.
          </li>
        </ul>

        <div className={styles.asideWarn}>
          <strong>Nothing is saved.</strong> There is no database. Close the tab
          without making a share link and the plan is gone — which is also why
          nobody, including us, has a copy of your customer addresses.
        </div>

        <h2>When something goes wrong</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>What you see</th>
              <th style={{ textAlign: "left" }}>What it means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Distances marked approximate</td>
              <td style={{ textAlign: "left" }}>
                The road-distance service was unreachable, so these are
                straight-line estimates. The plan still works; the numbers are
                optimistic.
              </td>
            </tr>
            <tr>
              <td>An address will not match</td>
              <td style={{ textAlign: "left" }}>
                Add a city or postcode. Failing that, place it on the map — a
                hand-placed pin is always trusted.
              </td>
            </tr>
            <tr>
              <td>Too many requests</td>
              <td style={{ textAlign: "left" }}>
                Rate limiting, to keep the service usable for everyone. Wait the
                number of seconds it names.
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: 28 }}>
          <Link href="/plan" className={styles.ctaLarge}>
            Plan routes
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}

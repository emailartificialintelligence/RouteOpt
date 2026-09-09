import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { MAX_STOPS } from "@/lib/schema";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "About — RoutePlan",
  description:
    "An open-source route optimiser for small delivery operations. What it is, what it deliberately is not, and where it falls short.",
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

export default function AboutPage() {
  return (
    <SiteShell>
      <article className={styles.prose}>
        <h1 className={styles.pageTitle}>About</h1>
        <p className={styles.lede}>
          A route optimiser for people running a handful of vans, who need a
          route once, today, without signing up for anything.
        </p>

        <h2>Who it is for</h2>
        <p>
          A dispatcher or owner-operator with twenty to eighty stops and two to
          six vehicles. Route optimisation at that scale is usually sold as a
          per-seat monthly subscription bundled with driver tracking, proof of
          delivery and a customer-notification suite. If all you want is the
          route, that is a lot of product to buy and a lot of onboarding to sit
          through.
        </p>

        <h2>What it deliberately is not</h2>
        <p>
          The absent features are choices, not a roadmap. Each one is a separate
          product, and adding them would turn a tool you can use in two minutes
          into one you have to adopt.
        </p>
        <ul>
          <li>
            <strong>No accounts.</strong> Nothing to sign up for or cancel.
          </li>
          <li>
            <strong>No database.</strong> Addresses are never stored. A share
            link carries the whole plan in the URL itself, and only exists if you
            make one.
          </li>
          <li>
            <strong>No driver tracking, no proof of delivery, no customer
            notifications.</strong> This plans routes.
          </li>
          <li>
            <strong>No analytics or trackers.</strong> Nothing follows you
            around.
          </li>
        </ul>

        <h2>Where it falls short</h2>
        <p>
          Worth knowing before you rely on it, and easier to say plainly than to
          have you discover:
        </p>
        <ul>
          <li>
            <strong>{MAX_STOPS} stops per plan.</strong> The road-distance
            service takes 100 coordinates per request and the depot uses one.
            Self-hosting lifts it.
          </li>
          <li>
            <strong>No time windows yet.</strong> If a customer only accepts
            deliveries between two and four, the plan does not know. The data
            format already carries the field, so adding it is not a rewrite.
          </li>
          <li>
            <strong>No vehicle capacities yet.</strong> Same story — the field
            exists, the solver ignores it.
          </li>
          <li>
            <strong>One depot.</strong> Every van starts and ends in the same
            place.
          </li>
          <li>
            <strong>Traffic is not modelled.</strong> Distances and times are
            free-flow. A round planned for rush hour will run long.
          </li>
        </ul>

        <h2>How it is built</h2>
        <p>
          Next.js and TypeScript, with the map on MapLibre and road distances
          from OSRM. Addresses are resolved by Photon or Nominatim, both built on
          OpenStreetMap. The routing engines are described on the{" "}
          <Link href="/algorithms">algorithms page</Link>.
        </p>
        <p>
          The map is a client of the same public API you can call yourself, so
          the API is exercised on every single plan and cannot quietly rot. It is
          documented on the <Link href="/api-docs">API page</Link>.
        </p>

        <h2>Licence and data</h2>
        <p>
          MIT licensed — use it, change it, run your own copy. Map data is
          © OpenStreetMap contributors, under the Open Database Licence.
        </p>

        <p style={{ marginTop: 28 }}>
          <Link href="/plan" className={styles.ctaLarge}>
            Plan routes
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}

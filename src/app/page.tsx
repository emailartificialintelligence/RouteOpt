import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { PlanPreview } from "@/components/site/PlanPreview";
import { HERO_STATS } from "@/components/site/heroPlan";
import { Arrow } from "@/components/site/Arrow";
import { Reveal } from "@/components/site/Reveal";
import { ROUTE_COLORS } from "@/lib/routes";
import { MAX_STOPS } from "@/lib/schema";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "RoutePlan — delivery routes without an account",
  description:
    "Paste your delivery addresses, set a depot, and get routes you can hand to drivers. Free, open source, no sign-up.",
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

/**
 * The landing page.
 *
 * Every claim here is a measured number from a real solve, not a rounded-up
 * marketing figure — the audience is a dispatcher who will check, and being
 * caught inflating one number costs you every other one.
 */
export default function LandingPage() {
  return (
    <SiteShell>
      <div className={styles.wrap}>
        <section className={styles.hero}>
          <span className={styles.badge}>
            Paste &middot; Confirm &middot; Plan &middot; Send
          </span>

          <h1 className={styles.heroTitle}>
            Delivery routes in under two minutes
          </h1>
          <p className={styles.heroLede}>
            Paste your stops, check every pin, and get a route for each driver.
            No account, no subscription, nothing to install — and your addresses
            are never stored.
          </p>

          <div className={styles.heroActions}>
            <Link href="/plan" className={styles.ctaLarge}>
              Plan routes
              <span className={styles.ctaArrow}>
                <Arrow />
              </span>
            </Link>
            <Link href="/how-it-works" className={styles.ctaGhost}>
              See how it works
            </Link>
          </div>

          <p className={styles.heroNote}>
            Free and open source. Up to {MAX_STOPS} stops per plan.
          </p>

          <div className={styles.heroFigure}>
            <PlanPreview />
            <p className={styles.previewCaption}>
              A real plan: {HERO_STATS.stops} stops, {HERO_STATS.vans} vans,{" "}
              {HERO_STATS.totalKm} km — down from {HERO_STATS.baselineKm} km in
              the order they were pasted.
            </p>
            {/* Required by the tile source, and by the people whose survey work
                the basemap is. Same credit the map inside the product carries. */}
            <p className={styles.previewAttribution}>
              Basemap{" "}
              <a href="https://openfreemap.org" rel="noopener noreferrer">
                OpenFreeMap
              </a>{" "}
              ·{" "}
              <a href="https://www.openmaptiles.org/" rel="noopener noreferrer">
                © OpenMapTiles
              </a>{" "}
              · Data{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                rel="noopener noreferrer"
              >
                © OpenStreetMap contributors
              </a>
            </p>
          </div>
        </section>

        <Reveal as="section" className={styles.section}>
          <p className={styles.eyebrow}>Measured, not estimated</p>
          <div className={styles.figures}>
            <div className={styles.figure}>
              <div className={styles.figureValue}>66%</div>
              <div className={styles.figureLabel}>
                shorter than list order, on a 40-stop round
              </div>
            </div>
            <div className={styles.figure}>
              <div className={styles.figureValue}>7 ms</div>
              <div className={styles.figureLabel}>
                to plan those 40 stops across three vans
              </div>
            </div>
            <div className={styles.figure}>
              <div className={styles.figureValue}>0</div>
              <div className={styles.figureLabel}>
                accounts, trackers or stored copies of your addresses
              </div>
            </div>
            <div className={styles.figure}>
              <div className={styles.figureValue}>{MAX_STOPS}</div>
              <div className={styles.figureLabel}>
                stops per plan, with real road distances
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className={styles.section}>
          <p className={styles.eyebrow}>How it works</p>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <h3 className={styles.stepTitle}>Paste your addresses</h3>
              <p className={styles.stepBody}>
                One per line, or upload a CSV. Coordinates work too, if you
                already have them.
              </p>
            </li>
            <li className={styles.step}>
              <h3 className={styles.stepTitle}>Check every pin</h3>
              <p className={styles.stepBody}>
                Anything the geocoder was unsure about is flagged before you
                plan. A wrong pin makes a nonsense route, so you see them all
                first.
              </p>
            </li>
            <li className={styles.step}>
              <h3 className={styles.stepTitle}>Send the routes</h3>
              <p className={styles.stepBody}>
                A Google Maps link for each driver, a printable manifest, and a
                share link for whoever else needs it.
              </p>
            </li>
          </ol>
        </Reveal>

        <Reveal as="section" className={styles.section}>
          <p className={styles.eyebrow}>What it does not do</p>
          <ul className={styles.checkList}>
            <li>
              <strong>No accounts.</strong> Nothing to sign up for, nothing to
              cancel.
            </li>
            <li>
              <strong>No stored addresses.</strong> There is no database. Your
              plan lives in the share link, and only if you make one.
            </li>
            <li>
              <strong>No driver tracking.</strong> This plans routes. It does
              not watch anybody.
            </li>
            <li>
              <strong>No lock-in.</strong> Everything is behind a documented
              public API, and the whole thing is MIT licensed.
            </li>
          </ul>
        </Reveal>

        <Reveal as="section" className={styles.section}>
          <p className={styles.eyebrow}>What you get out</p>
          <div className={styles.chipPanel}>
            <div>
              <p className={styles.chipGroupLabel}>Four ways to export</p>
              <div className={styles.chips}>
                <span className={styles.chip}>CSV per driver</span>
                <span className={styles.chip}>CSV, all routes</span>
                <span className={styles.chip}>JSON</span>
                <span className={styles.chip}>Printed manifest</span>
              </div>
            </div>
            <div>
              <p className={styles.chipGroupLabel}>A colour per vehicle</p>
              <div className={styles.chips}>
                {["Van 1", "Van 2", "Van 3", "Van 4"].map((label, i) => (
                  <span key={label} className={styles.chip}>
                    <span
                      className={styles.chipDot}
                      style={{ background: ROUTE_COLORS[i] }}
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className={`${styles.sectionRuled} ${styles.sectionCentered}`}>
          <h2 className={styles.sectionTitle}>Built on an open API</h2>
          <p className={styles.heroLede}>
            The map is a client of the same public endpoint you can call
            yourself. Every plan is one <code>POST</code> — no key, no account.
          </p>
          <div className={styles.heroActions}>
            <Link href="/plan" className={styles.ctaLarge}>
              Plan routes
              <span className={styles.ctaArrow}>
                <Arrow />
              </span>
            </Link>
            <Link href="/api-docs" className={styles.ctaGhost}>
              Read the API docs
            </Link>
          </div>
        </Reveal>

      </div>
    </SiteShell>
  );
}

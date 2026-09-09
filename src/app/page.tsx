import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { PlanPreview } from "@/components/site/PlanPreview";
import { HERO_STATS } from "@/components/site/heroPlan";
import { MAX_STOPS } from "@/lib/schema";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "RoutePlan — delivery routes without an account",
  description:
    "Paste your delivery addresses, set a depot, and get routes you can hand to drivers. Free, open source, no sign-up.",
};

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
          <div>
            <h1 className={styles.heroTitle}>
              Delivery routes in under two minutes.
            </h1>
            <p className={styles.heroLede}>
              Paste your stops, check the pins, get a route for each driver.
              No account, no subscription, nothing to install.
            </p>
            <div className={styles.heroActions}>
              <Link href="/plan" className={styles.ctaLarge}>
                Plan routes
              </Link>
              <Link href="/how-it-works" className={styles.ctaGhost}>
                See how it works
              </Link>
            </div>
            <p className={styles.heroNote}>
              Free and open source. Up to {MAX_STOPS} stops per plan.
            </p>
          </div>

          <div>
            <PlanPreview />
            <p className={styles.previewCaption}>
              A real plan: {HERO_STATS.stops} stops, {HERO_STATS.vans} vans,{" "}
              {HERO_STATS.totalKm} km — down from {HERO_STATS.baselineKm} km in
              the order they were pasted.
            </p>
          </div>
        </section>

        <section className={styles.section}>
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
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Three steps</h2>
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
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What it does not do</h2>
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
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Built on an open API</h2>
          <p className={styles.lede}>
            The map is a client of the same public endpoint you can call
            yourself. Every plan the app makes is one <code>POST</code> — no key,
            no account.
          </p>
          <div className={styles.heroActions} style={{ marginTop: 18 }}>
            <Link href="/api-docs" className={styles.ctaGhost}>
              Read the API docs
            </Link>
            <Link href="/algorithms" className={styles.ctaGhost}>
              How the routing works
            </Link>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}

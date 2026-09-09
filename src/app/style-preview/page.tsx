import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import styles from "@/components/site/site.module.css";

export const metadata: Metadata = {
  title: "Readability options — RoutePlan",
  robots: { index: false, follow: false },
};

/**
 * Three treatments for long prose over the dotted ground, side by side.
 *
 * A temporary page for choosing between them: identical copy in each, so the
 * only variable is the treatment. Delete this once a choice is made.
 */

const SAMPLE = (
  <>
    <h2>Step two: cluster first, then sequence</h2>
    <p>
      Here is the decision that shapes everything else. The obvious approach is
      one nearest-neighbour sweep across all the stops, opening a new vehicle
      each time the current one fills. It produces short routes and it looks
      broken.
    </p>
    <p>
      Clustering uses k-means, on coordinates projected into local metres rather
      than raw latitude and longitude. That projection matters: a degree of
      longitude is 111 km at the equator and 71 km in Paris, so clustering raw
      coordinates produces clusters stretched east-west for no geographic
      reason.
    </p>
    <ul>
      <li>
        <strong>Nearest neighbour</strong> builds a first route by always
        driving to the closest unvisited stop.
      </li>
      <li>
        <strong>2-opt</strong> reverses a segment when doing so shortens the
        route — this is what removes a route crossing itself.
      </li>
    </ul>
  </>
);

export default function StylePreviewPage() {
  return (
    <SiteShell>
      <div className={styles.wrap}>
        <h1 className={styles.pageTitle}>Readability options</h1>
        <p className={styles.lede}>
          The same paragraphs in three treatments, all with the dotted ground
          behind them. Tell me which letter you want and I will apply it
          everywhere and delete this page.
        </p>

        <div className={styles.variantGrid}>
          <section>
            <div className={styles.variantHead}>
              <h2 className={styles.variantName}>A — Panel</h2>
              <span className={styles.variantNote}>
                Solid paper, hairline border, soft shadow. Dots in the margins.
                Most readable, most &ldquo;document&rdquo;.
              </span>
            </div>
            <div className={`${styles.prose} ${styles.prosePanel}`}>{SAMPLE}</div>
          </section>

          <section>
            <div className={styles.variantHead}>
              <h2 className={styles.variantName}>B — Veil</h2>
              <span className={styles.variantNote}>
                Translucent wash; dots show through, softened. Texture stays
                present without fighting the words.
              </span>
            </div>
            <div className={`${styles.prose} ${styles.proseVeil}`}>{SAMPLE}</div>
          </section>

          <section>
            <div className={styles.variantHead}>
              <h2 className={styles.variantName}>C — Bare</h2>
              <span className={styles.variantNote}>
                No backdrop. Dots run right behind the text; readability comes
                from darker, larger type.
              </span>
            </div>
            <div className={`${styles.prose} ${styles.proseBare}`}>{SAMPLE}</div>
          </section>
        </div>

        <p style={{ marginTop: 48 }}>
          <Link href="/algorithms" className={styles.ctaGhost}>
            Back to the real page
          </Link>
        </p>
      </div>
    </SiteShell>
  );
}

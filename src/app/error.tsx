"use client";

import { useEffect } from "react";
import styles from "@/components/site/site.module.css";

/**
 * What a crash looks like.
 *
 * Without this a thrown error in a client component leaves a white screen — no
 * explanation, no way forward, and for a dispatcher mid-round, no idea whether
 * the stops they just entered still exist. Say what happened, offer the two
 * things that might help, and log the detail for whoever reads the console.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[routeplan] unhandled error:", error);
  }, [error]);

  return (
    <main className={styles.prose} style={{ paddingTop: 60 }}>
      <h1 className={styles.pageTitle}>Something broke.</h1>
      <p className={styles.lede}>
        That is a bug on our side, not something you did. Trying again often
        works — the plan you were building is still in this tab.
      </p>

      <div className={styles.heroActions} style={{ marginTop: 22 }}>
        <button type="button" onClick={reset} className={styles.ctaLarge}>
          Try again
        </button>
        <a href="/plan" className={styles.ctaGhost}>
          Start a new plan
        </a>
      </div>

      {error.digest && (
        <p className={styles.heroNote} style={{ marginTop: 20 }}>
          Reference: <code>{error.digest}</code>
        </p>
      )}
    </main>
  );
}

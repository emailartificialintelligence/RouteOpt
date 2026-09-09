import type { Metadata } from "next";
import { ShareError, decodeShare } from "@/lib/share";
import { formatDistance, pluralise } from "@/lib/format";
import { SharedPlan } from "@/components/SharedPlan";
import styles from "@/components/Planner.module.css";

/**
 * A plan opened from a link.
 *
 * Decoding happens on the server so a broken link renders an explanation rather
 * than a blank screen with a console error. The payload is untrusted input — it
 * may have been hand-edited, truncated by a messaging app, or produced by an
 * older build — so decodeShare re-validates it against the schema before any of
 * it reaches a component.
 */

interface PageProps {
  params: Promise<{ payload: string }>;
}

function BrokenLink({ message }: { message: string }) {
  return (
    <main className={styles.rail} style={{ maxWidth: 480, margin: "0 auto" }}>
      <header className={styles.masthead}>
        <h1 className={styles.wordmark}>RoutePlan</h1>
      </header>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>This link didn&apos;t open.</h2>
        <p className={styles.hint}>{message}</p>
        <div className={styles.actions}>
          <a className={styles.button} href="/">
            Plan new routes
          </a>
        </div>
      </section>
    </main>
  );
}

export default async function SharedPlanPage({ params }: PageProps) {
  const { payload } = await params;

  let decoded;
  try {
    decoded = decodeShare(decodeURIComponent(payload));
  } catch (err) {
    // ShareError messages are already written for a person who was just sent a
    // link that did not work. Anything else is a bug, and says less.
    const message =
      err instanceof ShareError
        ? err.message
        : "This link is incomplete or was cut off. Ask for a new one.";
    return <BrokenLink message={message} />;
  }

  const { problem, solution, createdAt } = decoded;

  return (
    <SharedPlan
      problem={problem}
      solution={solution}
      createdAt={createdAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}
    />
  );
}

/*
 * Shown in link previews when someone pastes the URL into a chat.
 *
 * This is the only metadata export: Next refuses a page that exports both
 * `metadata` and `generateMetadata`, and that is a build-time rule TypeScript
 * cannot see. The catch branch covers the broken-link case, so nothing is lost
 * by dropping the static one.
 *
 * Every branch marks the page noindex — a shared plan is somebody's delivery
 * round and has no business turning up in a search engine.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { payload } = await params;
  try {
    const { problem, solution } = decodeShare(decodeURIComponent(payload));
    return {
      title: `${pluralise(problem.stops.length, "stop")} — RoutePlan`,
      description: `${pluralise(solution.summary.vehiclesUsed, "van")}, ${formatDistance(
        solution.summary.totalDistance,
      )} total.`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: "Shared plan — RoutePlan", robots: { index: false, follow: false } };
  }
}

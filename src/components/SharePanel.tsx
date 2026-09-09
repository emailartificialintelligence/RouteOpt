"use client";

import { useCallback, useState } from "react";
import { ApiError, createShareLink } from "@/lib/api-client";
import { solveRequest } from "@/lib/curl";
import type { Problem, Solution } from "@/lib/schema";
import styles from "./Planner.module.css";

/**
 * Share the plan, and show the API call that produced it.
 *
 * The second half is the more important one. "View as API request" is the path
 * from someone planning a round today to someone integrating this next month,
 * and because the snippet is generated from the object that was actually
 * posted, it cannot drift from reality the way a hand-written example does.
 */

interface SharePanelProps {
  problem: Problem;
  solution: Solution;
  /**
   * Whether to offer a share link. False on a shared plan: the reader already
   * has the link, and re-sharing it from there implies they can change what it
   * points at, which they cannot.
   */
  allowShare?: boolean;
}

type Copied = "none" | "link" | "curl" | "json";

export function SharePanel({
  problem,
  solution,
  allowShare = true,
}: SharePanelProps) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApi, setShowApi] = useState(false);
  const [copied, setCopied] = useState<Copied>("none");

  const request = solveRequest(
    typeof window === "undefined" ? "" : window.location.origin,
    problem,
  );

  const flash = useCallback((what: Copied) => {
    setCopied(what);
    window.setTimeout(() => setCopied("none"), 2000);
  }, []);

  const copy = useCallback(
    async (text: string, what: Copied) => {
      try {
        await navigator.clipboard.writeText(text);
        flash(what);
      } catch {
        setError("Couldn't copy to the clipboard. Your browser blocked it.");
      }
    },
    [flash],
  );

  const share = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createShareLink(problem, solution);
      setLink(created.url);
      await copy(created.url, "link");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't build a link for this plan. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }, [problem, solution, copy]);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{allowShare ? "Share" : "API"}</h2>
      </div>

      <div className={styles.actions}>
        {allowShare && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void share()}
            disabled={busy}
          >
            {busy ? "Building link…" : copied === "link" ? "Link copied" : "Copy share link"}
          </button>
        )}
        <button
          type="button"
          className={showApi ? styles.toggleOn : styles.secondary}
          onClick={() => setShowApi(!showApi)}
          aria-expanded={showApi}
        >
          View as API request
        </button>
      </div>

      {link && (
        <p className={styles.hint}>
          Anyone with this link sees the plan, read-only.{" "}
          <a href={link} target="_blank" rel="noreferrer noopener">
            Open it
          </a>
        </p>
      )}

      {error && (
        <div className={styles.notice} role="alert">
          {error}
        </div>
      )}

      {showApi && (
        <>
          <p className={styles.hint}>
            This is the exact call the page just made. No key, no account.
          </p>

          {/*
            * Rendered as text, never markup. The same panel appears on shared
            * plans, where every label came out of somebody else's URL.
            */}
          <pre className={styles.code}>{request.curl}</pre>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void copy(request.curl, "curl")}
            >
              {copied === "curl" ? "Copied" : "Copy curl"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void copy(request.body, "json")}
            >
              {copied === "json" ? "Copied" : "Copy JSON"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

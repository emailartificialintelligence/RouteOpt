"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./site.module.css";

/**
 * Fades a section up as it enters view.
 *
 * Built so it cannot hide content. The earlier version started hidden in CSS
 * and waited for IntersectionObserver to reveal it — which meant any path where
 * that callback did not run left the whole page blank below the hero. It did,
 * in production, twice.
 *
 * So the default state is now *visible*, and the hidden state is applied by
 * JavaScript in a layout effect — before the browser paints, so there is no
 * flash. If the script never runs, never hydrates, or throws, the content is
 * simply there and only the animation is missing. An animation must never be
 * the thing standing between a reader and the words.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  /** Milliseconds, for staggering siblings. */
  delay?: number;
  as?: "div" | "section" | "li";
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  /** "ready" until JS decides to animate; then "pending", then "shown". */
  const [phase, setPhase] = useState<"ready" | "pending" | "shown">("ready");

  // Before paint: decide whether to animate at all, and hide only if so.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Already on screen — show it as it is rather than animating what the
    // reader is about to look at.
    if (node.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    setPhase("pending");
  }, []);

  useEffect(() => {
    if (phase !== "pending") return;
    const node = ref.current;
    if (!node) return;

    const reveal = () => setPhase("shown");

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        reveal();
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.01 },
    );
    observer.observe(node);

    // Backstop, in case the observer never fires. Short: a reader who has
    // scrolled here is waiting.
    const failsafe = window.setTimeout(reveal, 900);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [phase]);

  return (
    <Tag
      ref={ref as never}
      className={[
        className,
        phase === "pending" ? styles.revealPending : "",
        phase === "shown" ? styles.revealShown : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={delay && phase !== "ready" ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

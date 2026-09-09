"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./site.module.css";

/**
 * Fades a section up as it comes into view.
 *
 * Driven by IntersectionObserver rather than scroll position, so nothing runs
 * on the main thread while the page is idle. Two rules keep it from becoming
 * irritating:
 *
 *   - It fires once. Content that re-animates every time it re-enters the
 *     viewport makes a page feel unstable to anyone who scrolls back up.
 *   - Anything already on screen at load renders immediately. Animating the
 *     content someone came to read, before they can read it, is a tax rather
 *     than a flourish.
 *
 * Respecting prefers-reduced-motion is not optional here: the reduced-motion
 * branch renders visible with no transition at all, rather than a faster one.
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
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(true);
      return;
    }

    // Already in view on load — show it now rather than animating it in.
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      // Fire slightly before the element arrives, so it has finished by the
      // time it is properly on screen.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    observer.observe(node);

    /*
     * Failsafe: show it regardless after a short delay.
     *
     * An animation that hides content until an event fires has turned a visual
     * flourish into a single point of failure for the words themselves. The
     * observer can go unfired for reasons that have nothing to do with the
     * user — a background tab that never paints, an embedded or headless view,
     * a browser that throttles callbacks. Any of those would leave the page
     * permanently blank below the hero.
     *
     * If the observer works this never matters; it fires first. If it does
     * not, the content appears anyway and only the animation is lost.
     */
    const failsafe = window.setTimeout(() => setShown(true), 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={[styles.reveal, shown ? styles.revealShown : "", className]
        .filter(Boolean)
        .join(" ")}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

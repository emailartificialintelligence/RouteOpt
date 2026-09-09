"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./site.module.css";

/**
 * Navigation for the content pages.
 *
 * Deliberately absent from /plan. Someone on that page is working, the map is
 * the product, and trading a strip of it for marketing links would be a poor
 * bargain — the wordmark in the app's own rail is the way back here.
 */

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/algorithms", label: "Algorithms" },
  { href: "/api-docs", label: "API" },
  { href: "/about", label: "About" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        RoutePlan
      </Link>

      <nav className={styles.nav} aria-label="Site">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? styles.navLinkActive : styles.navLink}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
        <Link href="/plan" className={styles.cta}>
          Plan routes
        </Link>
      </nav>
    </header>
  );
}

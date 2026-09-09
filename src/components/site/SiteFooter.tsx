import Link from "next/link";
import styles from "./site.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>
          RoutePlan — open source, MIT licensed. No account, no tracking.
        </span>
        <div className={styles.footerLinks}>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/algorithms">Algorithms</Link>
          <Link href="/api-docs">API</Link>
          <Link href="/about">About</Link>
          <a
            href="https://github.com/emailartificialintelligence/RouteOpt"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}

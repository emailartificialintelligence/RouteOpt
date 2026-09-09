import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import styles from "./site.module.css";

/**
 * Header, content, footer. Every page except the tool itself.
 *
 * The dotted ground is applied here rather than to the body, so it stops at the
 * edge of the marketing pages — behind a full-bleed map it would be noise.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.page} dotted`}>
      <SiteHeader />
      <main className={styles.main}>{children}</main>
      <SiteFooter />
    </div>
  );
}

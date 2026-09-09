import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import styles from "./site.module.css";

/** Header, content, footer. Every page except the tool itself. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.main}>{children}</main>
      <SiteFooter />
    </div>
  );
}

import type { Metadata } from "next";
import { Planner } from "@/components/Planner";

/**
 * Rendered per request, not prerendered at build time.
 *
 * The Content-Security-Policy in middleware.ts uses a per-request nonce, and a
 * statically generated page has no request to take one from — Next emits the
 * HTML at build time with no nonce, and the policy then blocks every script on
 * the page. The symptom is a blank screen in production while development,
 * which renders dynamically anyway, works perfectly.
 *
 * The cost is small: this page fetches nothing at build time and is a client
 * application below the shell.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plan routes — RoutePlan",
  description:
    "Paste your delivery addresses, set a depot, and get routes you can hand to drivers.",
};

/**
 * The tool itself: one screen, full-bleed map, no navigation chrome.
 *
 * The site header deliberately stops at this page. A dispatcher who has arrived
 * here is working, and the map is the product — giving up a strip of it to
 * marketing links would be a poor trade. The wordmark in the rail is the way
 * back out.
 */
export default function PlanPage() {
  return <Planner />;
}

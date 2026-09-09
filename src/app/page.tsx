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

/**
 * The whole app is one screen. There is no dashboard to navigate and no account
 * to create: a dispatcher arrives with a list of addresses and leaves with
 * routes, in one sitting.
 */
export default function Home() {
  return <Planner />;
}

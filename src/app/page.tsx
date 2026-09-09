import { Planner } from "@/components/Planner";

/**
 * The whole app is one screen. There is no dashboard to navigate and no account
 * to create: a dispatcher arrives with a list of addresses and leaves with
 * routes, in one sitting.
 */
export default function Home() {
  return <Planner />;
}

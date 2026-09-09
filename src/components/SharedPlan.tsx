"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { fetchRouteGeometries } from "@/lib/api-client";
import { problemToDraft } from "@/lib/plan";
import { routePath } from "@/lib/routes";
import type { Problem, Solution } from "@/lib/schema";
import { RouteSummary } from "./RouteSummary";
import { SharePanel } from "./SharePanel";
import type { DrawnRoute } from "./MapCanvas";
import styles from "./Planner.module.css";

/**
 * Somebody else's plan, opened from a link.
 *
 * Read-only on purpose. The person who made this already confirmed every pin;
 * offering edit controls here would invite someone to change a plan their
 * driver is already following, with no way to tell them it changed.
 *
 * Everything rendered comes from a URL a stranger could have written, so it is
 * all text through React — never markup. See dom-safety.test.ts.
 */

const MapCanvas = dynamic(
  () => import("./MapCanvas").then((m) => m.MapCanvas),
  { ssr: false, loading: () => <div style={{ position: "absolute", inset: 0 }} /> },
);

interface SharedPlanProps {
  problem: Problem;
  solution: Solution;
  createdAt: string;
}

export function SharedPlan({ problem, solution, createdAt }: SharedPlanProps) {
  const draft = useMemo(() => problemToDraft(problem), [problem]);
  const [drawnRoutes, setDrawnRoutes] = useState<DrawnRoute[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  /*
   * Straight lines immediately, road shapes when they arrive. The plan is
   * already decided, so the drawing is the only thing waiting on the network,
   * and it is allowed to stay straight if that call fails.
   */
  useEffect(() => {
    const working = solution.routes.filter((r) => r.stops.length > 0);
    const paths = working.map((route) => routePath(problem, route));

    setDrawnRoutes(
      working.map((route, i) => ({
        vehicleIndex: route.vehicleIndex,
        path: paths[i],
        followsRoads: false,
      })),
    );

    const controller = new AbortController();
    void fetchRouteGeometries(paths, controller.signal).then((geometries) => {
      if (controller.signal.aborted) return;
      setDrawnRoutes(
        working.map((route, i) => {
          const road = geometries[i];
          return {
            vehicleIndex: route.vehicleIndex,
            path: road ?? paths[i],
            followsRoads: road !== null,
          };
        }),
      );
    });
    return () => controller.abort();
  }, [problem, solution]);

  return (
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="Shared plan">
        <header className={styles.masthead}>
          <h1 className={styles.wordmark}>RoutePlan</h1>
          <span className={styles.tagline}>Shared plan</span>
        </header>

        <RouteSummary
          problem={problem}
          solution={solution}
          onPrint={() => window.print()}
        />

        {/*
          * The API view belongs on every result, including this one. Somebody
          * who was sent a plan is exactly the person who might want to make one
          * themselves — the snippet is the shortest path from reading to
          * integrating.
          */}
        <SharePanel problem={problem} solution={solution} allowShare={false} />

        <footer className={styles.footer}>
          <p className={styles.headlineNote}>Planned {createdAt}.</p>
          <a className={styles.linkButton} href="/">
            Plan your own routes
          </a>
        </footer>
      </aside>

      <div className={styles.mapPane}>
        <MapCanvas
          draft={draft}
          routes={drawnRoutes}
          planId={1}
          fitRequest={1}
          mode="idle"
          readOnly
          selectedStopId={selectedStopId}
          onMapClick={() => {}}
          onStopMoved={() => {}}
          onDepotMoved={() => {}}
          onStopSelected={setSelectedStopId}
        />
      </div>
    </div>
  );
}

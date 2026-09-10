import type { CSSProperties } from "react";
import { routeColor } from "@/lib/routes";
import {
  HERO_DEPOT,
  HERO_MARKERS,
  HERO_PATHS,
  HERO_VIEWBOX,
} from "./heroPlan";
import styles from "./site.module.css";

/**
 * A real solved plan, drawn as SVG, that draws itself on once on load.
 *
 * The paths are actual streets from a real solve — twelve Paris stops across
 * three vans — not an illustration. A landing page that invents a prettier map
 * than the product can draw is writing a cheque the app has to cash on first
 * use.
 *
 * The motion is the same moment the product has after a solve: routes drawing
 * on, one vehicle after another. That is the point of animating it here rather
 * than decorating — the page previews what pressing "Plan routes" looks like,
 * instead of showing a still of the aftermath.
 *
 * It plays once. A route redrawing every few seconds behind the headline is a
 * distraction on a page someone is trying to read.
 *
 * All of it is CSS. There is no script, no observer and no state, so there is
 * nothing that can fail to fire and leave the hero blank — the completed map is
 * the base state and the keyframes only override it while they run.
 */

/** One vehicle's line, start to finish. */
const DRAW_MS = 1100;
/** How far apart the vans start. Less than DRAW_MS, so they overlap. */
const STAGGER_MS = 800;

const vehicleStart = (vehicle: number) => vehicle * STAGGER_MS;

/**
 * Roughly when the line reaches a given stop.
 *
 * Position in the route, not distance along the path: the legs are not equal
 * lengths, so a marker can land a little before or after the line arrives. At
 * this speed that reads as natural rather than wrong, and measuring properly
 * would mean running the path through getPointAtLength at build time for a
 * difference nobody can see.
 */
function markerDelay(vehicle: number, position: number, stopsOnRoute: number) {
  const through = position / (stopsOnRoute + 1);
  return Math.round(vehicleStart(vehicle) + through * DRAW_MS);
}

/** Custom properties need the cast; React types don't know about them. */
const delay = (ms: number): CSSProperties =>
  ({ "--preview-delay": `${ms}ms` }) as CSSProperties;

export function PlanPreview() {
  // How many stops each van has, so a marker's delay is its position along
  // that van's route rather than its position in the list.
  const stopsPerVehicle = HERO_MARKERS.reduce<Record<number, number>>(
    (acc, m) => ({ ...acc, [m.v]: Math.max(acc[m.v] ?? 0, m.n) }),
    {},
  );

  const drawStyle = (vehicle: number): CSSProperties =>
    ({
      "--preview-delay": `${vehicleStart(vehicle)}ms`,
      "--preview-draw": `${DRAW_MS}ms`,
    }) as CSSProperties;

  return (
    <svg
      className={styles.preview}
      viewBox={`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`}
      role="img"
      aria-label="Twelve delivery stops across Paris, split between three vans, each route drawn in its own colour."
    >
      {/*
        * The real basemap, not a backdrop.
        *
        * Rendered from OpenFreeMap — the same tile source the product draws
        * with — for exactly the bounds this viewBox covers, so every route sits
        * on the street it was actually solved along. The red route follows the
        * Périphérique, the green one crosses to the Bois de Vincennes, and the
        * Seine passes under each crossing where it should.
        *
        * Baked to a static image rather than a live map: a landing page does
        * not need a WebGL context and a few hundred tile requests to show one
        * fixed view, and this cannot fail to load a style and leave a hole.
        */}
      <image
        href="/hero-paris.webp"
        x={0}
        y={0}
        width={HERO_VIEWBOX.width}
        height={HERO_VIEWBOX.height}
        preserveAspectRatio="none"
      />
      {/* Takes the map back toward the muted ground the route colours were
          chosen against, so eight hues stay separable over real streets. */}
      <rect
        width={HERO_VIEWBOX.width}
        height={HERO_VIEWBOX.height}
        fill="var(--paper)"
        opacity={0.28}
      />

      {/* Casings first, so no route is drawn over another's colour. Each is
          animated with its own line so the white halo never runs ahead of it. */}
      {HERO_PATHS.map((d, i) => (
        <path
          key={`casing-${i}`}
          className={styles.previewCasing}
          style={drawStyle(i)}
          d={d}
          pathLength={1}
          fill="none"
          stroke="var(--paper)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {HERO_PATHS.map((d, i) => (
        <path
          key={`route-${i}`}
          className={styles.previewRoute}
          style={drawStyle(i)}
          d={d}
          /* Normalises every route to one unit long, so three lines of very
             different real lengths draw in the same time. */
          pathLength={1}
          fill="none"
          stroke={routeColor(i)}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {/*
        * Sized in viewBox units against the width this actually renders at
        * (~470 px for a 720-unit box, so roughly 0.65). At r=9 the numbers came
        * out under 6 px on screen and could not be read — the whole point of a
        * numbered stop.
        */}
      {HERO_MARKERS.map((m) => (
        <g
          key={`${m.v}-${m.n}-${m.x}`}
          className={styles.previewMarker}
          style={delay(markerDelay(m.v, m.n, stopsPerVehicle[m.v] ?? 1))}
        >
          <circle cx={m.x} cy={m.y} r={13} fill="var(--ink)" stroke="var(--paper)" strokeWidth={2.5} />
          <text
            x={m.x}
            y={m.y + 4.6}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill="var(--paper)"
          >
            {m.n}
          </text>
        </g>
      ))}

      {/* The depot is a square. Shape carries the meaning before colour does.
          It lands first: every route starts there. */}
      <g className={styles.previewDepot} style={delay(0)}>
        <rect
          x={HERO_DEPOT.x - 13}
          y={HERO_DEPOT.y - 13}
          width={26}
          height={26}
          rx={2}
          fill="var(--signal)"
          stroke="var(--paper)"
          strokeWidth={2.5}
        />
        <text
          x={HERO_DEPOT.x}
          y={HERO_DEPOT.y + 4.8}
          textAnchor="middle"
          fontSize={13}
          fontWeight={700}
          fill="var(--paper)"
        >
          D
        </text>
      </g>
    </svg>
  );
}

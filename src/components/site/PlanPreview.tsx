import { routeColor } from "@/lib/routes";
import {
  HERO_DEPOT,
  HERO_MARKERS,
  HERO_PATHS,
  HERO_VIEWBOX,
} from "./heroPlan";
import styles from "./site.module.css";

/**
 * A real solved plan, drawn as SVG.
 *
 * The paths are actual streets from a real solve — twelve Paris stops across
 * three vans — not an illustration. A landing page that invents a prettier map
 * than the product can draw is writing a cheque the app has to cash on first
 * use.
 *
 * Static by design: no animation. The single piece of motion in this product is
 * routes drawing on after a solve, and spending it on decoration here would
 * make the real one mean nothing.
 */
export function PlanPreview() {
  return (
    <svg
      className={styles.preview}
      viewBox={`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`}
      role="img"
      aria-label="Twelve delivery stops across Paris, split between three vans, each route drawn in its own colour."
    >
      <rect
        width={HERO_VIEWBOX.width}
        height={HERO_VIEWBOX.height}
        fill="var(--paper-sunk)"
      />

      {/* Casings first, so no route is drawn over another's colour. */}
      {HERO_PATHS.map((d, i) => (
        <path
          key={`casing-${i}`}
          d={d}
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
          d={d}
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
        <g key={`${m.v}-${m.n}-${m.x}`}>
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

      {/* The depot is a square. Shape carries the meaning before colour does. */}
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
    </svg>
  );
}

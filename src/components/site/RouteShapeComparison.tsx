import { routeColor } from "@/lib/routes";
import {
  CLUSTERED_PATHS,
  COMPARE_DEPOT,
  COMPARE_STATS,
  COMPARE_STOPS,
  COMPARE_VIEWBOX,
  NAIVE_PATHS,
} from "./compareRoutes";
import styles from "./site.module.css";

/**
 * Why the solver clusters before it sequences.
 *
 * Both panels are generated from the same twelve real stops. The naive routes
 * genuinely do cross — that is not an exaggeration drawn to make a point.
 */

function Panel({
  paths,
  title,
  note,
}: {
  paths: readonly string[];
  title: string;
  note: string;
}) {
  return (
    <figure className={styles.panel}>
      <svg
        viewBox={`0 0 ${COMPARE_VIEWBOX.width} ${COMPARE_VIEWBOX.height}`}
        className={styles.panelSvg}
        role="img"
        aria-label={`${title}. ${note}`}
      >
        <rect
          width={COMPARE_VIEWBOX.width}
          height={COMPARE_VIEWBOX.height}
          fill="var(--paper-sunk)"
        />
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={routeColor(i)}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.9}
          />
        ))}
        {COMPARE_STOPS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={3} fill="var(--ink)" stroke="var(--paper)" strokeWidth={1.2} />
        ))}
        <rect
          x={COMPARE_DEPOT.x - 5}
          y={COMPARE_DEPOT.y - 5}
          width={10}
          height={10}
          fill="var(--signal)"
          stroke="var(--paper)"
          strokeWidth={1.5}
        />
      </svg>
      <figcaption className={styles.panelCaption}>
        <strong>{title}</strong>
        <span>{note}</span>
      </figcaption>
    </figure>
  );
}

export function RouteShapeComparison() {
  return (
    <div className={styles.panels}>
      <Panel
        paths={NAIVE_PATHS}
        title="One global sweep"
        note={`Vans interleave and cover the same ground. ${COMPARE_STATS.naiveKm} km.`}
      />
      <Panel
        paths={CLUSTERED_PATHS}
        title="Cluster first, then sequence"
        note={`Each van keeps to its own area. ${COMPARE_STATS.clusteredKm} km.`}
      />
    </div>
  );
}

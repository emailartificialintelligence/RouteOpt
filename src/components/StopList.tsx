"use client";

import { displayName, type DraftStop } from "@/lib/plan";
import { formatCoordinate } from "@/lib/format";
import styles from "./Planner.module.css";

/**
 * The confirmation step, and the reason this phase exists.
 *
 * A geocoder never refuses: ask it for a street it has no data for and it hands
 * back the town, or the country, with no error attached. The route that follows
 * looks completely plausible and sends a driver to the wrong place. So every
 * pin gets listed, every doubtful match says why it is doubtful, and the plan
 * cannot be solved until a person has been shown all of it.
 */

interface StopListProps {
  stops: DraftStop[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onChoose: (id: string, candidateIndex: number) => void;
}

function statusLabel(stop: DraftStop): { text: string; className: string } {
  switch (stop.status) {
    case "pending":
      return { text: "Looking up", className: styles.status };
    case "failed":
      return { text: "No match", className: styles.statusFailed };
    case "review":
      return { text: "Check", className: styles.statusReview };
    case "manual":
      return { text: "Placed", className: styles.status };
    case "located":
      return { text: "", className: styles.status };
  }
}

export function StopList({
  stops,
  selectedId,
  onSelect,
  onRemove,
  onChoose,
}: StopListProps) {
  if (stops.length === 0) {
    return (
      <p className={styles.empty}>Paste your delivery addresses, one per line.</p>
    );
  }

  return (
    <ul className={styles.stopList}>
      {stops.map((stop, index) => {
        const status = statusLabel(stop);
        const selected = stop.id === selectedId;
        const name = displayName(stop, index);
        // Only worth a second line when it is not already the name.
        const secondary = stop.address && stop.address !== name ? stop.address : null;
        const coords =
          stop.lat !== null && stop.lng !== null
            ? formatCoordinate(stop.lat, stop.lng)
            : null;
        const showCandidates =
          selected && stop.status === "review" && (stop.candidates?.length ?? 0) > 1;

        return (
          <li key={stop.id}>
            <button
              type="button"
              className={`${styles.stop} ${selected ? styles.stopSelected : ""}`}
              onClick={() => onSelect(selected ? null : stop.id)}
              aria-current={selected}
            >
              <span className={styles.index}>{index + 1}</span>
              <span className={styles.stopName}>
                {name}
                {secondary && <span className={styles.stopAddress}>{secondary}</span>}
                {/*
                  * The coordinates are the stop's actual identity — the address
                  * is only how it was found. Showing them makes a bad geocode
                  * or a mis-dropped pin visible without leaving the list.
                  */}
                {coords && (
                  <span className={styles.stopCoords} data-numeric>
                    {coords}
                  </span>
                )}
                {stop.note && <span className={styles.stopNote}>{stop.note}</span>}
              </span>
              <span className={status.className}>{status.text}</span>
            </button>

            {showCandidates && (
              <ul className={styles.candidates}>
                {stop.candidates?.map((candidate, candidateIndex) => (
                  <li key={`${candidate.lat},${candidate.lng}`}>
                    <button
                      type="button"
                      className={styles.candidate}
                      onClick={() => onChoose(stop.id, candidateIndex)}
                    >
                      {candidate.displayName}{" "}
                      <span className={styles.candidateMeta}>
                        ({candidate.lat.toFixed(4)}, {candidate.lng.toFixed(4)})
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected && (
              <div className={styles.candidates}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onRemove(stop.id)}
                >
                  Remove this stop
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

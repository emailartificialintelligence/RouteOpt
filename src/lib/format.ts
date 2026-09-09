/**
 * Formatting lives at the edge.
 *
 * Everything inside the app is metres and seconds; nothing but these functions
 * turns those into words. Keeping that boundary sharp is what stops a "km"
 * creeping into a solver, which is the kind of bug that produces a plausible
 * route that is wrong by a factor of a thousand.
 *
 * The register is a delivery manifest: short, unfussy, and readable at a glance
 * by someone holding a steering wheel.
 */

/** Metres to a distance a driver would say out loud. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  // Past 100 km a decimal place is noise, not precision.
  return km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

/**
 * Seconds to a duration.
 *
 * Hours read as "1 h 05" rather than "65 min" because a dispatcher is comparing
 * these against a working day, and "1 h 05" is the unit they think in.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  // Guard on raw seconds: rounding first turns 45s into "1 min", which
  // overstates a leg that a driver experiences as no time at all.
  if (seconds < 60) return "under a minute";
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

/**
 * A clock time, given an offset from departure.
 * Routes are planned as offsets so the plan survives being made the night
 * before; this renders them against whatever start the user is looking at.
 */
export function formatArrival(offsetSeconds: number, startHour = 9): string {
  const total = Math.round(offsetSeconds / 60) + startHour * 60;
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * How much shorter the plan is than the order the stops were pasted in.
 * Returns null when there is nothing honest to claim — the baseline is missing,
 * or the optimised route is not actually shorter.
 */
export function formatSaving(
  optimised: number,
  baseline: number,
): { percent: number; text: string } | null {
  if (!Number.isFinite(optimised) || !Number.isFinite(baseline)) return null;
  if (baseline <= 0 || optimised >= baseline) return null;
  const percent = Math.round((1 - optimised / baseline) * 100);
  if (percent < 1) return null;
  return { percent, text: `${percent}% shorter than your list order` };
}

/** "3 stops", "1 stop". Small, but it appears everywhere. */
export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * A coordinate as a driver or dispatcher would check it.
 *
 * Five decimal places is about a metre — finer than any delivery needs and fine
 * enough to tell two doors apart. Fixed precision keeps the column aligned
 * under tabular numerals, which is the whole reason for showing it: a stop that
 * has drifted is obvious when the numbers line up.
 */
export function formatCoordinate(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "—";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

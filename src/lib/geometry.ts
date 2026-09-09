/**
 * Road geometry for drawing a route.
 *
 * A solution says which stops a vehicle visits and in what order; it does not
 * say what the road between them looks like, and it should not — solvers are
 * pure and the geometry is worth thousands of coordinates that nobody needs in
 * order to compute a plan.
 *
 * So this is a separate lookup, called after a solve. Two consequences that are
 * both deliberate:
 *
 *   - the Solution wire contract is untouched, so share links stay small. A
 *     hundred-stop plan compresses to a few KB precisely because the polylines
 *     are not in it.
 *   - it is allowed to fail. Straight lines between stops are a worse-looking
 *     but perfectly usable map, so a geometry outage degrades the drawing
 *     rather than the plan.
 */

// Same service as the distance matrix; see matrix.ts for the self-hosting note.
const OSRM_BASE_URL =
  process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
const OSRM_TIMEOUT_MS = Number(process.env.OSRM_TIMEOUT_MS ?? 8000);

/** The public demo server will not route through more points than this. */
export const MAX_GEOMETRY_COORDINATES = 100;

export type LngLat = [number, number];

interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: { geometry?: { coordinates?: [number, number][] } }[];
}

export class GeometryError extends Error {
  constructor(
    public code: "TOO_MANY_COORDINATES" | "GEOMETRY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "GeometryError";
  }
}

/**
 * Snap an ordered list of points to the road network.
 *
 * Input and output are both [lng, lat] — the order OSRM and MapLibre share, and
 * the one the rest of the app converts to at its boundary.
 */
export async function fetchRouteGeometry(
  path: LngLat[],
  profile = "driving",
): Promise<LngLat[]> {
  if (path.length < 2) return path;
  if (path.length > MAX_GEOMETRY_COORDINATES) {
    throw new GeometryError(
      "TOO_MANY_COORDINATES",
      `Road shapes are limited to ${MAX_GEOMETRY_COORDINATES} points per route.`,
    );
  }

  const coords = path.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `${OSRM_BASE_URL}/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new GeometryError(
        "GEOMETRY_UNAVAILABLE",
        `Road shapes are unavailable right now (${res.status}).`,
      );
    }

    const body = (await res.json()) as OsrmRouteResponse;
    const line = body.routes?.[0]?.geometry?.coordinates;
    if (body.code !== "Ok" || !line || line.length === 0) {
      throw new GeometryError(
        "GEOMETRY_UNAVAILABLE",
        body.message ?? "Road shapes are unavailable right now.",
      );
    }

    return line;
  } finally {
    clearTimeout(timer);
  }
}

import { createHash } from "node:crypto";
import type { Coordinate, Problem } from "./schema";
import { envNumber, envUrl } from "./env";
import { haversine } from "./solver/greedy";
import type { Matrix } from "./solver/types";

/**
 * The distance matrix is the real cost and the real bottleneck, not the solver.
 * N stops means N+1 squared pairs: 100 stops is 10,201 lookups.
 *
 * The public OSRM demo server is rate-limited and explicitly not for production.
 * Self-host before launch:
 *   docker run -p 5000:5000 osrm/osrm-backend osrm-routed --algorithm mld /data/region.osrm
 * then set OSRM_BASE_URL=http://localhost:5000
 */
// envUrl/envNumber rather than ??: a hosting dashboard stores a blank variable
// as "", which `??` passes through — giving an unparseable base URL or a zero
// timeout, and failing only once deployed.
const OSRM_BASE_URL = envUrl(
  process.env.OSRM_BASE_URL,
  "https://router.project-osrm.org",
);
const OSRM_TIMEOUT_MS = envNumber(process.env.OSRM_TIMEOUT_MS, 8000);

/** Public demo servers cap the table endpoint here. */
const OSRM_TABLE_LIMIT = 100;

/**
 * Process-local cache. Fine for a single instance; move to Redis when you run
 * more than one. Coordinates are rounded to ~1m before hashing so that a
 * dragged-then-restored pin still hits the cache.
 */
const cache = new Map<string, Matrix>();
const CACHE_MAX_ENTRIES = 200;

function cacheKey(coords: Coordinate[], profile: string): string {
  const canonical = coords
    .map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`)
    .join(";");
  return createHash("sha1").update(`${profile}|${canonical}`).digest("hex");
}

function remember(key: string, matrix: Matrix): Matrix {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, matrix);
  return matrix;
}

/* -------------------------------------------------------------- haversine */

/**
 * Fallback only. Straight-line distance ignores rivers, one-way systems and
 * motorways, so it is wrong in every city. The solution carries
 * matrixSource: "haversine" so the UI can say distances are approximate.
 *
 * The detour factor is a crude correction for road networks not being straight.
 * 1.3 is the usual rule of thumb for urban grids.
 */
const DETOUR_FACTOR = 1.3;
const ASSUMED_SPEED_MPS = 8.3; // ~30 km/h, a realistic urban delivery average

export function haversineMatrix(coords: Coordinate[]): Matrix {
  const n = coords.length;
  const distances: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );
  const durations: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(coords[i], coords[j]) * DETOUR_FACTOR;
      distances[i][j] = d;
      distances[j][i] = d;
      const t = d / ASSUMED_SPEED_MPS;
      durations[i][j] = t;
      durations[j][i] = t;
    }
  }

  return { distances, durations, source: "haversine", size: n };
}

/* ------------------------------------------------------------------- OSRM */

interface OsrmTableResponse {
  code: string;
  message?: string;
  distances?: (number | null)[][];
  durations?: (number | null)[][];
}

async function fetchOsrmMatrix(
  coords: Coordinate[],
  profile: string,
): Promise<Matrix> {
  // OSRM wants lng,lat. This ordering mismatch causes most map bugs.
  const path = coords.map((c) => `${c.lng},${c.lat}`).join(";");
  const url = `${OSRM_BASE_URL}/table/v1/${profile}/${path}?annotations=duration,distance`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);

    const body = (await res.json()) as OsrmTableResponse;
    if (body.code !== "Ok" || !body.distances || !body.durations) {
      throw new Error(body.message ?? `OSRM returned ${body.code}`);
    }

    // A null entry means no route between that pair — an island, a pedestrian
    // zone, a bad geocode. Substituting Infinity would make the solver produce
    // nonsense, so fall back to a corrected straight line for that pair only.
    const n = coords.length;
    const distances: number[][] = [];
    const durations: number[][] = [];

    for (let i = 0; i < n; i++) {
      distances.push([]);
      durations.push([]);
      for (let j = 0; j < n; j++) {
        const d = body.distances[i]?.[j];
        const t = body.durations[i]?.[j];
        if (d === null || d === undefined) {
          const fallback = haversine(coords[i], coords[j]) * DETOUR_FACTOR;
          distances[i].push(fallback);
          durations[i].push(fallback / ASSUMED_SPEED_MPS);
        } else {
          distances[i].push(d);
          durations[i].push(t ?? d / ASSUMED_SPEED_MPS);
        }
      }
    }

    return { distances, durations, source: "osrm", size: n };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ public */

export interface MatrixResult {
  matrix: Matrix;
  /** Non-fatal problems worth surfacing in the UI. */
  warnings: string[];
}

/**
 * Build the matrix over [depot, ...stops].
 * Degrades to straight-line distances rather than failing the request: a plan
 * with approximate distances beats no plan, as long as the UI says so.
 */
export async function buildMatrix(problem: Problem): Promise<MatrixResult> {
  const coords: Coordinate[] = [
    { lat: problem.depot.lat, lng: problem.depot.lng },
    ...problem.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];

  const profile = problem.vehicles[0]?.profile ?? "driving";
  const warnings: string[] = [];

  if (coords.length > OSRM_TABLE_LIMIT) {
    warnings.push(
      `Road distances are limited to ${OSRM_TABLE_LIMIT - 1} stops. Using estimates instead.`,
    );
    return { matrix: haversineMatrix(coords), warnings };
  }

  const key = cacheKey(coords, profile);
  const hit = cache.get(key);
  if (hit) return { matrix: hit, warnings };

  try {
    const matrix = await fetchOsrmMatrix(coords, profile);
    return { matrix: remember(key, matrix), warnings };
  } catch (err) {
    warnings.push(
      "Road distances were unavailable, so these routes use straight-line estimates.",
    );
    console.warn("[matrix] OSRM failed, falling back to haversine:", err);
    return { matrix: haversineMatrix(coords), warnings };
  }
}

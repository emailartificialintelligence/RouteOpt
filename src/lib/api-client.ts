import type { GeocodeResult } from "./geocode";
import type { LngLat } from "./geometry";
import type { Problem, Solution } from "./schema";
import { MAX_QUERIES_PER_REQUEST } from "./limits";

/**
 * The browser's view of the public API.
 *
 * Every network call the UI makes goes through here, and every one of them hits
 * the same endpoints an external client would. There is no private path from
 * the map to the server: the API is exercised on every interaction, so it
 * cannot quietly rot before the day it gets documented.
 */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(
      body.error?.code ?? "UNKNOWN",
      // The server writes user-facing copy. Prefer it over anything invented here.
      body.error?.message ?? "Something went wrong. Try again in a moment.",
      response.status,
    );
  } catch {
    return new ApiError(
      "UNKNOWN",
      "The server sent something unexpected. Try again in a moment.",
      response.status,
    );
  }
}

/* -------------------------------------------------------------- geocoding */

export interface GeocodeProgress {
  done: number;
  total: number;
}

/**
 * Look up a list of addresses, a batch at a time.
 *
 * Results are handed back per batch rather than at the end, so pins appear on
 * the map while the rest are still resolving. Forty addresses at one lookup per
 * second is forty seconds; watching that happen is tolerable, staring at a
 * spinner for it is not.
 */
export async function geocodeAddresses(
  queries: string[],
  onBatch: (results: GeocodeResult[], progress: GeocodeProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  let done = 0;

  for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_REQUEST) {
    if (signal?.aborted) return;

    const batch = queries.slice(i, i + MAX_QUERIES_PER_REQUEST);
    const response = await fetch("/api/v1/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: batch }),
      signal,
    });

    if (!response.ok) throw await readError(response);

    const body = (await response.json()) as { results: GeocodeResult[] };
    done += batch.length;
    onBatch(body.results, { done, total: queries.length });
  }
}

/* ---------------------------------------------------------------- solving */

/**
 * Solve a plan.
 *
 * This is the same POST an external client would make. The map has no private
 * path to the solver, which is the point: the public API is exercised on every
 * single solve, so it cannot quietly rot before the day it gets documented.
 */
export async function solveProblem(
  problem: Problem,
  signal?: AbortSignal,
): Promise<Solution> {
  const response = await fetch("/api/v1/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(problem),
    signal,
  });

  if (!response.ok) throw await readError(response);
  return (await response.json()) as Solution;
}

/** What the solver selector renders. Engine names are never hardcoded in the UI. */
export interface SolverInfo {
  name: string;
  label: string;
  available: boolean;
  description: string;
}

export interface ApiCapabilities {
  maxStops: number;
  solvers: SolverInfo[];
  objectives: { value: string; label: string; description: string }[];
}

export async function fetchCapabilities(
  signal?: AbortSignal,
): Promise<ApiCapabilities> {
  const response = await fetch("/api/v1/solve", { signal });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ApiCapabilities;
}

/* --------------------------------------------------------------- geometry */

/**
 * Road shapes for the drawn routes.
 *
 * Never throws: the plan is already computed and correct by the time this is
 * called, and a missing road shape only means straighter lines. Returning nulls
 * lets the caller fall back per route rather than losing the whole drawing.
 */
export async function fetchRouteGeometries(
  paths: LngLat[][],
  signal?: AbortSignal,
): Promise<(LngLat[] | null)[]> {
  if (paths.length === 0) return [];
  try {
    const response = await fetch("/api/v1/route-geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
      signal,
    });
    if (!response.ok) return paths.map(() => null);
    const body = (await response.json()) as { geometries: (LngLat[] | null)[] };
    return body.geometries;
  } catch {
    return paths.map(() => null);
  }
}

/* ------------------------------------------------------------------ share */

export interface ShareLink {
  token: string;
  url: string;
  length: number;
  maxLength: number;
}

/**
 * Turn the current plan into a link.
 *
 * Goes through the API rather than encoding in the browser, even though the
 * encoder is isomorphic: Phase 5 moves payloads server-side behind a short id,
 * and when it does this call does not change.
 */
export async function createShareLink(
  problem: Problem,
  solution: Solution,
  signal?: AbortSignal,
): Promise<ShareLink> {
  const response = await fetch("/api/v1/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problem, solution }),
    signal,
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as ShareLink;
}

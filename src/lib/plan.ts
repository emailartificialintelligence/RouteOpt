import type { GeocodeCandidate, GeocodeResult } from "./geocode";
import type { ParsedRow } from "./parse";
import type { Problem } from "./schema";

/**
 * The draft a dispatcher edits before anything is solved.
 *
 * This is deliberately not a Problem. A Problem is the wire contract and every
 * stop in it has coordinates; a draft is the messy in-between where a stop can
 * be un-geocoded, ambiguous, or dragged somewhere by hand. Keeping them
 * separate is what lets the UI refuse to solve until every stop is placed,
 * rather than shipping a half-valid Problem to the API and reading the error.
 *
 * Everything here is pure. The components own the state; these functions only
 * describe how it changes.
 */

export type StopStatus =
  /** Parsed, not looked up yet. */
  | "pending"
  /** Looked up, one good match. */
  | "located"
  /** Placed, but the match was vague or there were several. Needs a human. */
  | "review"
  /** No match. Has no coordinates and cannot be solved. */
  | "failed"
  /** Positioned by hand, on the map. Trusted, never re-looked-up. */
  | "manual";

export interface DraftStop {
  id: string;
  label?: string;
  address?: string;
  lat: number | null;
  lng: number | null;
  status: StopStatus;
  /** User-facing copy about this stop's match. */
  note?: string;
  /** Alternatives when the lookup was ambiguous, best first. */
  candidates?: GeocodeCandidate[];
  /** The original line, so the UI can show what was read. */
  raw?: string;
}

export interface DraftDepot {
  label?: string;
  address?: string;
  lat: number | null;
  lng: number | null;
}

export interface Draft {
  depot: DraftDepot;
  stops: DraftStop[];
}

export const emptyDraft = (): Draft => ({
  depot: { lat: null, lng: null },
  stops: [],
});

/* ------------------------------------------------------------------- ids */

/**
 * Stable ids that survive re-parsing.
 *
 * The id ends up in the manifest and in share links, so it must not be an array
 * index: deleting stop 3 would silently renumber every stop after it and change
 * what a shared link points at.
 */
let idCounter = 0;
export function nextStopId(): string {
  idCounter += 1;
  return `s${idCounter}`;
}

/** Tests and repeated pastes need a predictable starting point. */
export function resetStopIds(): void {
  idCounter = 0;
}

/* ------------------------------------------------------------ construction */

export function rowsToDraftStops(rows: ParsedRow[]): DraftStop[] {
  return rows.map((row) =>
    row.kind === "coordinate"
      ? {
          id: nextStopId(),
          label: row.label,
          lat: row.lat,
          lng: row.lng,
          // Coordinates came from the user, not a guess. Nothing to confirm.
          status: "manual" as const,
          raw: row.raw,
        }
      : {
          id: nextStopId(),
          label: row.label,
          address: row.address,
          lat: null,
          lng: null,
          status: "pending" as const,
          raw: row.raw,
        },
  );
}

/** What to send the geocoder: the address, qualified by its label if it has one. */
export function geocodeQueryFor(stop: DraftStop): string {
  return stop.address ?? stop.label ?? "";
}

/* ---------------------------------------------------------------- updating */

export function applyGeocodeResult(
  stop: DraftStop,
  result: GeocodeResult,
): DraftStop {
  const best = result.candidates[0];

  if (result.status === "not_found" || !best) {
    return {
      ...stop,
      lat: null,
      lng: null,
      status: "failed",
      note: result.note,
      candidates: [],
    };
  }

  return {
    ...stop,
    lat: best.lat,
    lng: best.lng,
    // "ok" with a note (a street match) is still worth showing, but it does not
    // block solving. Only genuinely ambiguous matches do.
    status: result.status === "ambiguous" ? "review" : "located",
    note: result.note,
    candidates: result.candidates,
  };
}

/** The user picked one of the alternatives. That settles it. */
export function chooseCandidate(stop: DraftStop, index: number): DraftStop {
  const chosen = stop.candidates?.[index];
  if (!chosen) return stop;
  return {
    ...stop,
    lat: chosen.lat,
    lng: chosen.lng,
    status: "located",
    note: undefined,
    label: stop.label,
  };
}

/** Dragged on the map, or clicked into place. A hand-placed pin is the truth. */
export function placeStopByHand(
  stop: DraftStop,
  lat: number,
  lng: number,
): DraftStop {
  return { ...stop, lat, lng, status: "manual", note: undefined, candidates: [] };
}

/* ---------------------------------------------------------------- readiness */

export interface DraftSummary {
  total: number;
  /** Has coordinates and needs no further attention. */
  placed: number;
  /** Placed, but the match wants a human's eye. */
  needsReview: number;
  /** No coordinates. Cannot be solved. */
  unplaced: number;
  pending: number;
  hasDepot: boolean;
  /** Every stop is placed and a depot is set. */
  canSolve: boolean;
  /** Placed stops still carrying a warning. */
  blockingReasons: string[];
}

export function summarise(draft: Draft): DraftSummary {
  const total = draft.stops.length;
  const pending = draft.stops.filter((s) => s.status === "pending").length;
  const needsReview = draft.stops.filter((s) => s.status === "review").length;
  const unplaced = draft.stops.filter(
    (s) => s.lat === null || s.lng === null,
  ).length;
  const placed = total - unplaced;
  const hasDepot = draft.depot.lat !== null && draft.depot.lng !== null;

  const blockingReasons: string[] = [];
  if (!hasDepot) blockingReasons.push("Set a depot to start from.");
  if (total === 0) blockingReasons.push("Add at least one stop.");
  if (pending > 0) blockingReasons.push(`${pending} still to look up.`);
  if (unplaced > 0) {
    blockingReasons.push(
      unplaced === 1
        ? "One address didn't match. Fix it or remove it."
        : `${unplaced} addresses didn't match. Fix them or remove them.`,
    );
  }

  return {
    total,
    placed,
    needsReview,
    unplaced,
    pending,
    hasDepot,
    canSolve: blockingReasons.length === 0,
    blockingReasons,
  };
}

/* ------------------------------------------------------------------ extent */

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The box containing everything placed, for fitting the map.
 * Returns null when there is nothing to frame, so the caller can leave the
 * viewport where the user put it instead of jumping to null island.
 */
export function draftBounds(draft: Draft): Bounds | null {
  const points: { lat: number; lng: number }[] = [];
  if (draft.depot.lat !== null && draft.depot.lng !== null) {
    points.push({ lat: draft.depot.lat, lng: draft.depot.lng });
  }
  for (const stop of draft.stops) {
    if (stop.lat !== null && stop.lng !== null) {
      points.push({ lat: stop.lat, lng: stop.lng });
    }
  }
  if (points.length === 0) return null;

  return points.reduce<Bounds>(
    (box, p) => ({
      west: Math.min(box.west, p.lng),
      south: Math.min(box.south, p.lat),
      east: Math.max(box.east, p.lng),
      north: Math.max(box.north, p.lat),
    }),
    {
      west: points[0].lng,
      south: points[0].lat,
      east: points[0].lng,
      north: points[0].lat,
    },
  );
}

/**
 * What the driver reads on the manifest. Never blank.
 *
 * Deliberately does not fall back to the raw source line: for a stop pasted as
 * a coordinate pair the raw text is the coordinates, and the UI shows those on
 * their own line anyway. Using it here would print them twice.
 */
export function displayName(stop: DraftStop, index: number): string {
  return stop.label ?? stop.address ?? `Stop ${index + 1}`;
}

/* --------------------------------------------------------------- rehydrate */

/**
 * A shared plan, back into the shape the map draws.
 *
 * Every stop in a Problem has coordinates by definition — the schema will not
 * accept one without — so they all come back as settled. Nothing is re-geocoded
 * and nothing is flagged for review: the person who made the plan already did
 * that, and re-litigating their decisions in a read-only view would be noise.
 */
export function problemToDraft(problem: Problem): Draft {
  return {
    depot: {
      label: problem.depot.label ?? "Depot",
      address: problem.depot.address,
      lat: problem.depot.lat,
      lng: problem.depot.lng,
    },
    stops: problem.stops.map((stop) => ({
      id: stop.id,
      label: stop.label,
      address: stop.address,
      lat: stop.lat,
      lng: stop.lng,
      status: "located" as const,
    })),
  };
}

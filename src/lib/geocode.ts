import { createHash } from "node:crypto";
import { MAX_QUERIES_PER_REQUEST } from "./limits";

/**
 * Address to coordinate.
 *
 * The named trap in BUILD_PLAN.md is a geocoder quietly putting a stop in the
 * wrong country, and the reason it is quiet is that Nominatim always answers.
 * Ask it for "10 Downing Street" in a country it has no street data for and it
 * returns the city, or the country centroid, with no error at all. The route
 * then looks plausible and is wrong.
 *
 * So this module does not just return a point. It returns how precise the match
 * was and what else matched, and the UI refuses to solve until a human has
 * looked at the pins. Precision is the product feature here, not the lookup.
 *
 * Nominatim's usage policy is one request per second with a real contact
 * address in the User-Agent. Honour it or you get blocked, which in practice
 * means the app stops working for everyone at once. Swap for Photon or a
 * self-hosted instance before real traffic.
 */

/**
 * Which geocoding service to use.
 *
 * Nominatim's public instance is for development: one request per second, and
 * it will block a deployment that leans on it. Photon (also OSM data, run by
 * Komoot) has no such per-second rule and no key, which makes it the sensible
 * default for anything real — and self-hosting either removes the question.
 *
 * Both are supported because they disagree about precision in ways that matter
 * to the confirmation step, so swapping is a config change, not a rewrite.
 */
export type GeocoderProvider = "nominatim" | "photon";

const GEOCODER_PROVIDER: GeocoderProvider =
  process.env.GEOCODER_PROVIDER === "photon" ? "photon" : "nominatim";

const DEFAULT_BASE_URL: Record<GeocoderProvider, string> = {
  nominatim: "https://nominatim.openstreetmap.org",
  photon: "https://photon.komoot.io",
};

const GEOCODER_BASE_URL =
  process.env.GEOCODER_BASE_URL ?? DEFAULT_BASE_URL[GEOCODER_PROVIDER];
/*
 * Nominatim rejects requests it cannot attribute, and it rejects obvious
 * placeholders outright — an unset default returns 403 on the very first
 * lookup, which reads to a new contributor as "the app is broken". A project
 * URL is a valid contact under the usage policy, so the default identifies the
 * project rather than pretending to be a person.
 */
const GEOCODER_USER_AGENT =
  process.env.GEOCODER_USER_AGENT ??
  "RoutePlan/0.1 (+https://github.com/routeplan/routeplan)";
const GEOCODER_TIMEOUT_MS = Number(process.env.GEOCODER_TIMEOUT_MS ?? 8000);

/** Nominatim's published rate limit. Not a suggestion. */
/*
 * Nominatim's policy is one request per second and it is enforced. Photon has
 * no equivalent rule, so the default drops to something polite rather than
 * punitive — the difference is 44 seconds versus 4 on a 40-address paste.
 */
const MIN_REQUEST_SPACING_MS = Number(
  process.env.GEOCODER_SPACING_MS ?? (GEOCODER_PROVIDER === "photon" ? 100 : 1100),
);


/* -------------------------------------------------------------------- types */

/**
 * How closely the answer matches what was asked.
 *   exact       — a building or house number
 *   street      — the right road, but not the number
 *   area        — a suburb, town or country. Almost always wrong for delivery.
 */
export { MAX_QUERIES_PER_REQUEST };

/** Which service is configured. Surfaced so operators can confirm it. */
export const activeProvider = (): GeocoderProvider => GEOCODER_PROVIDER;

export type GeocodePrecision = "exact" | "street" | "area";

export type GeocodeStatus = "ok" | "ambiguous" | "not_found";

export interface GeocodeCandidate {
  lat: number;
  lng: number;
  displayName: string;
  precision: GeocodePrecision;
  /** Nominatim's own type, kept for debugging a bad match. */
  osmType?: string;
}

export interface GeocodeResult {
  query: string;
  status: GeocodeStatus;
  /** Best first. Empty when nothing matched. */
  candidates: GeocodeCandidate[];
  /** User-facing copy explaining why this one needs a look. */
  note?: string;
}

export class GeocodeError extends Error {
  constructor(
    public code: "GEOCODE_FAILED" | "GEOCODE_RATE_LIMITED" | "TOO_MANY_QUERIES",
    message: string,
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

/* ------------------------------------------------------------------ pure bits */

/**
 * Map Nominatim's place types onto delivery precision.
 *
 * The distinction that matters is "can a driver park here" versus "this is the
 * middle of a town". Everything not recognised as a building or a road is
 * treated as an area, because an unknown type defaulting to "precise" is how a
 * country centroid ends up on the manifest.
 */
const EXACT_TYPES = new Set([
  "house",
  "house_number",
  "building",
  "residential",
  "apartments",
  "commercial",
  "retail",
  "industrial",
  "warehouse",
  "office",
  "shop",
  "amenity",
  "yes",
]);

const STREET_TYPES = new Set([
  "road",
  "street",
  "footway",
  "pedestrian",
  "service",
  "living_street",
  "unclassified",
  "tertiary",
  "secondary",
  "primary",
  "trunk",
  "motorway",
]);

export function classifyPrecision(
  addressType: string | undefined,
  osmClass: string | undefined,
  hasHouseNumber: boolean,
): GeocodePrecision {
  if (hasHouseNumber) return "exact";
  const type = (addressType ?? "").toLowerCase();
  if (EXACT_TYPES.has(type)) return "exact";
  if (STREET_TYPES.has(type)) return "street";
  if (osmClass === "building" || osmClass === "shop" || osmClass === "office") {
    return "exact";
  }
  if (osmClass === "highway") return "street";
  return "area";
}

/** Two candidates within this distance are the same place answered twice. */
const SAME_PLACE_DEGREES = 0.0005; // roughly 50m

function samePlace(a: GeocodeCandidate, b: GeocodeCandidate): boolean {
  return (
    Math.abs(a.lat - b.lat) < SAME_PLACE_DEGREES &&
    Math.abs(a.lng - b.lng) < SAME_PLACE_DEGREES
  );
}

/**
 * Decide whether a human needs to look at this one.
 *
 * Ambiguity is not just "more than one result". Nominatim happily returns five
 * rows for the same building. What deserves a second look is two genuinely
 * different places, or a single match too coarse to deliver to.
 */
export function assessCandidates(
  query: string,
  candidates: GeocodeCandidate[],
): GeocodeResult {
  if (candidates.length === 0) {
    return {
      query,
      status: "not_found",
      candidates: [],
      note: "No match. Check the spelling, or add a city or postcode.",
    };
  }

  const distinct = candidates.filter(
    (c, i) => candidates.findIndex((other) => samePlace(c, other)) === i,
  );

  const best = distinct[0];

  if (distinct.length > 1) {
    return {
      query,
      status: "ambiguous",
      candidates: distinct,
      note: `${distinct.length} places match. Pick the right one.`,
    };
  }

  if (best.precision === "area") {
    return {
      query,
      status: "ambiguous",
      candidates: distinct,
      note: "Only matched an area, not a street address. Check the pin.",
    };
  }

  if (best.precision === "street") {
    return {
      query,
      status: "ok",
      candidates: distinct,
      note: "Matched the street but not the number.",
    };
  }

  return { query, status: "ok", candidates: distinct };
}

/* ------------------------------------------------------------------ caching */

const cache = new Map<string, GeocodeResult>();
const CACHE_MAX_ENTRIES = 1000;

function cacheKey(query: string): string {
  return createHash("sha1")
    .update(query.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}

function remember(key: string, result: GeocodeResult): GeocodeResult {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}

/* ------------------------------------------------------------- rate limiting */

/**
 * Serialise every outbound lookup, process-wide, with a minimum gap.
 *
 * Per-request throttling is not enough: ten browsers pasting lists at once
 * would still burst past the policy. Move this to a shared store when you run
 * more than one instance.
 */
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive even when one lookup rejects.
  queueTail = run.catch(() => undefined);
  return run;
}

/* ---------------------------------------------------------------- Nominatim */

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  class?: string;
  address?: { house_number?: string };
}

/**
 * Photon returns GeoJSON, not Nominatim rows.
 *
 * Its precision signal is the `type` property — "house", "street", "city" —
 * which maps onto the same three-way distinction the confirmation step needs.
 * A `housenumber` property is the strongest signal available and is treated the
 * same way as Nominatim's, so an operator swapping providers does not silently
 * change how strict the "check this pin" warning is.
 */
interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
    type?: string;
    osm_key?: string;
  };
}

/** Photon has no display_name; build one that reads like an address. */
export function photonDisplayName(properties: PhotonFeature["properties"]): string {
  const p = properties ?? {};
  const line = [p.housenumber, p.street].filter(Boolean).join(" ");
  return [p.name && p.name !== p.street ? p.name : null, line || null, p.postcode, p.city, p.state, p.country]
    .filter(Boolean)
    .join(", ");
}

export function photonToCandidates(features: PhotonFeature[]): GeocodeCandidate[] {
  return features
    .map((f) => {
      const coords = f.geometry?.coordinates;
      const p = f.properties ?? {};
      return {
        // GeoJSON is [lng, lat]. Reading it as [lat, lng] is the classic way to
        // land a stop in the sea.
        lat: Number(coords?.[1]),
        lng: Number(coords?.[0]),
        displayName: photonDisplayName(p),
        precision: classifyPrecision(p.type, p.osm_key, Boolean(p.housenumber)),
        osmType: p.type,
      };
    })
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
}

function buildLookupUrl(query: string): URL {
  if (GEOCODER_PROVIDER === "photon") {
    const url = new URL("/api", GEOCODER_BASE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set("lang", "en");
    return url;
  }
  const url = new URL("/search", GEOCODER_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  return url;
}

async function lookup(query: string): Promise<GeocodeResult> {
  const url = buildLookupUrl(query);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": GEOCODER_USER_AGENT,
        "Accept-Language": "en",
      },
    });

    if (res.status === 429) {
      throw new GeocodeError(
        "GEOCODE_RATE_LIMITED",
        "The address lookup service is rate limiting us. Wait a minute and try again.",
      );
    }
    // 403 from Nominatim is almost always attribution, not the address: an
    // unidentified or blocked User-Agent. Saying "try again" would send someone
    // round a loop that cannot terminate, so name the actual fix.
    if (res.status === 403) {
      throw new GeocodeError(
        "GEOCODE_FAILED",
        "The address lookup service refused the request. Set GEOCODER_USER_AGENT to a real contact address or project URL.",
      );
    }
    if (!res.ok) {
      throw new GeocodeError(
        "GEOCODE_FAILED",
        `Address lookup responded ${res.status}. Try again in a moment.`,
      );
    }

    const body = await res.json();

    const candidates: GeocodeCandidate[] =
      GEOCODER_PROVIDER === "photon"
        ? photonToCandidates(
            ((body as { features?: PhotonFeature[] }).features ?? []),
          )
        : (body as NominatimPlace[])
            .map((p) => ({
              lat: Number(p.lat),
              lng: Number(p.lon),
              displayName: p.display_name,
              precision: classifyPrecision(
                p.addresstype ?? p.type,
                p.class,
                Boolean(p.address?.house_number),
              ),
              osmType: p.addresstype ?? p.type,
            }))
            .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));

    return assessCandidates(query, candidates);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Geocode a batch, in order, respecting the rate limit.
 *
 * One address failing must not fail the batch: the caller gets a result row for
 * every query it sent, and the UI shows which ones need attention. Losing 39
 * good matches because the 40th timed out is not an acceptable trade.
 */
export async function geocodeBatch(queries: string[]): Promise<GeocodeResult[]> {
  if (queries.length > MAX_QUERIES_PER_REQUEST) {
    throw new GeocodeError(
      "TOO_MANY_QUERIES",
      `Look up at most ${MAX_QUERIES_PER_REQUEST} addresses at a time.`,
    );
  }

  const results: GeocodeResult[] = [];

  for (const query of queries) {
    const trimmed = query.trim();
    if (trimmed === "") {
      results.push({
        query,
        status: "not_found",
        candidates: [],
        note: "Empty line.",
      });
      continue;
    }

    const key = cacheKey(trimmed);
    const hit = cache.get(key);
    if (hit) {
      results.push({ ...hit, query });
      continue;
    }

    try {
      const result = await schedule(() => lookup(trimmed));
      results.push(remember(key, result));
    } catch (err) {
      if (err instanceof GeocodeError && err.code === "GEOCODE_RATE_LIMITED") {
        throw err; // Whole batch is doomed; say so rather than mark 10 failures.
      }
      console.warn("[geocode] lookup failed:", trimmed, err);
      results.push({
        query: trimmed,
        status: "not_found",
        candidates: [],
        note: "Lookup failed. Try again, or place this stop on the map.",
      });
    }
  }

  return results;
}

/**
 * Turning pasted text into stops.
 *
 * This is the first thing that touches user data and the last place a mistake
 * is cheap. A line dropped silently here becomes a delivery that never happens,
 * so nothing is discarded without an issue explaining which line and why.
 *
 * Two entry points, deliberately kept apart:
 *   parseAddressList — the paste panel. One address per line, the whole line.
 *   parseCsv         — the upload path. label,address or label,lat,lng.
 *
 * They are separate because "Acme Corp, 10 Downing Street" is a single address
 * to someone pasting a list and two fields to someone uploading a spreadsheet.
 * Guessing between those reads as the software mangling your data.
 */

export interface ParsedCoordinate {
  kind: "coordinate";
  label?: string;
  lat: number;
  lng: number;
  /** The source text, so the UI can show what it read. */
  raw: string;
  /** 1-based line number in the input. */
  line: number;
}

export interface ParsedAddress {
  kind: "address";
  label?: string;
  address: string;
  raw: string;
  line: number;
}

export type ParsedRow = ParsedCoordinate | ParsedAddress;

export interface ParseIssue {
  line: number;
  raw: string;
  /** User-facing copy: what was wrong and what to do. */
  reason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  issues: ParseIssue[];
}

/** Practical ceiling so one pasted spreadsheet cannot set your compute bill. */
export const MAX_INPUT_LINES = 500;

/* ------------------------------------------------------------------ tidying */

/**
 * Strip list decoration people paste along with their addresses: "1.", "12)",
 * a bullet, a dash. Leaving it in sends "1. 10 Downing Street" to the geocoder,
 * which is a good way to land in the wrong country.
 *
 * A leading number is only decoration when punctuation follows it. "10 Downing
 * Street" must survive untouched, so a bare number then a space is left alone.
 */
export function stripListDecoration(line: string): string {
  return line.replace(/^\s*(?:[-•*–—]\s+|\d{1,3}\s*[.)]\s+)/, "").trim();
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/* -------------------------------------------------------------- coordinates */

const COORD_PATTERN = /^[-+]?\d{1,3}(?:\.\d+)?$/;

function asNumber(value: string): number | null {
  const cleaned = value.trim();
  if (!COORD_PATTERN.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface CoordinateCheck {
  ok: boolean;
  /** Set when the pair is only valid the other way round. */
  looksSwapped: boolean;
}

/**
 * Latitude runs to 90, longitude to 180. A pair that fails as (lat, lng) but
 * passes as (lng, lat) is almost always the [lng, lat] ordering leaking in from
 * GeoJSON or a routing export. Saying so is far better than dropping the row.
 */
export function checkCoordinate(lat: number, lng: number): CoordinateCheck {
  const ok = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const swapped = lng >= -90 && lng <= 90 && lat >= -180 && lat <= 180;
  return { ok, looksSwapped: !ok && swapped };
}

/** "48.8566, 2.3522" and "48.8566 2.3522" are both a coordinate pair. */
function readCoordinatePair(text: string): { lat: number; lng: number } | null {
  const parts = text.includes(",") ? text.split(",") : text.split(/\s+/);
  if (parts.length !== 2) return null;
  const lat = asNumber(parts[0]);
  const lng = asNumber(parts[1]);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

/* -------------------------------------------------------------- paste panel */

/**
 * One stop per line. The whole line is the address, because that is what the
 * empty state asks for. A line that is nothing but a coordinate pair is taken
 * literally so pasting exported coordinates skips geocoding entirely.
 */
export function parseAddressList(input: string): ParseResult {
  const rows: ParsedRow[] = [];
  const issues: ParseIssue[] = [];

  const lines = input.split(/\r?\n/);
  let used = 0;

  lines.forEach((original, index) => {
    const line = index + 1;
    const cleaned = stripWrappingQuotes(stripListDecoration(original));
    if (cleaned === "") return;

    if (used >= MAX_INPUT_LINES) {
      issues.push({
        line,
        raw: original.trim(),
        reason: `Over the ${MAX_INPUT_LINES}-line limit. Split this into two plans.`,
      });
      return;
    }
    used++;

    const pair = readCoordinatePair(cleaned);
    if (pair) {
      const check = checkCoordinate(pair.lat, pair.lng);
      if (check.ok) {
        rows.push({ kind: "coordinate", lat: pair.lat, lng: pair.lng, raw: cleaned, line });
        return;
      }
      if (check.looksSwapped) {
        issues.push({
          line,
          raw: cleaned,
          reason: "Looks like longitude and latitude are the wrong way round. Use lat, lng.",
        });
        return;
      }
      issues.push({
        line,
        raw: cleaned,
        reason: "That is not a point on Earth. Latitude runs to 90, longitude to 180.",
      });
      return;
    }

    rows.push({ kind: "address", address: cleaned, raw: cleaned, line });
  });

  return { rows, issues };
}

/* ------------------------------------------------------------- CSV uploads */

/** RFC4180-ish: handles quoted fields and doubled quotes inside them. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === "," || char === ";" || char === "\t") {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current.trim());
  return fields;
}

const HEADER_WORDS = new Set([
  "label",
  "name",
  "address",
  "lat",
  "latitude",
  "lng",
  "lon",
  "long",
  "longitude",
  "stop",
  "customer",
  "location",
]);

/** A first row of column names must not become a delivery to "Address". */
export function looksLikeHeader(fields: string[]): boolean {
  const named = fields.filter((f) => HEADER_WORDS.has(f.toLowerCase().trim()));
  return named.length >= Math.min(2, fields.length);
}

/**
 * label,address or label,lat,lng. The shape is decided per row by whether the
 * last two fields are numbers, so a file that mixes geocoded and un-geocoded
 * rows still works — which is exactly what a half-finished spreadsheet is.
 */
export function parseCsv(input: string): ParseResult {
  const rows: ParsedRow[] = [];
  const issues: ParseIssue[] = [];

  const lines = input.split(/\r?\n/);
  let used = 0;
  let checkedHeader = false;

  lines.forEach((original, index) => {
    const line = index + 1;
    if (original.trim() === "") return;

    const fields = splitCsvLine(original);

    if (!checkedHeader) {
      checkedHeader = true;
      if (looksLikeHeader(fields)) return;
    }

    if (used >= MAX_INPUT_LINES) {
      issues.push({
        line,
        raw: original.trim(),
        reason: `Over the ${MAX_INPUT_LINES}-line limit. Split this into two plans.`,
      });
      return;
    }
    used++;

    const nonEmpty = fields.filter((f) => f !== "");
    if (nonEmpty.length === 0) return;

    // label,lat,lng — the last two fields being numeric is the tell.
    if (fields.length >= 3) {
      const lat = asNumber(fields[fields.length - 2]);
      const lng = asNumber(fields[fields.length - 1]);
      if (lat !== null && lng !== null) {
        const label = fields.slice(0, -2).filter((f) => f !== "").join(", ");
        const check = checkCoordinate(lat, lng);
        if (check.ok) {
          rows.push({
            kind: "coordinate",
            label: label || undefined,
            lat,
            lng,
            raw: original.trim(),
            line,
          });
          return;
        }
        issues.push({
          line,
          raw: original.trim(),
          reason: check.looksSwapped
            ? "Looks like longitude and latitude are the wrong way round. Use lat, lng."
            : "That is not a point on Earth. Latitude runs to 90, longitude to 180.",
        });
        return;
      }
    }

    // A bare coordinate pair with no label.
    if (fields.length === 2) {
      const lat = asNumber(fields[0]);
      const lng = asNumber(fields[1]);
      if (lat !== null && lng !== null) {
        const check = checkCoordinate(lat, lng);
        if (check.ok) {
          rows.push({ kind: "coordinate", lat, lng, raw: original.trim(), line });
          return;
        }
        issues.push({
          line,
          raw: original.trim(),
          reason: check.looksSwapped
            ? "Looks like longitude and latitude are the wrong way round. Use lat, lng."
            : "That is not a point on Earth. Latitude runs to 90, longitude to 180.",
        });
        return;
      }
    }

    // label,address — everything after the first field is the address.
    if (fields.length >= 2) {
      const [label, ...rest] = fields;
      const address = rest.filter((f) => f !== "").join(", ");
      if (address === "") {
        rows.push({ kind: "address", address: label, raw: original.trim(), line });
        return;
      }
      rows.push({
        kind: "address",
        label: label || undefined,
        address,
        raw: original.trim(),
        line,
      });
      return;
    }

    rows.push({ kind: "address", address: nonEmpty[0], raw: original.trim(), line });
  });

  return { rows, issues };
}

/** Upload path: a .csv extension is a promise about the shape, so honour it. */
export function parseUpload(filename: string, contents: string): ParseResult {
  return /\.(csv|tsv|txt)$/i.test(filename) && /[,;\t]/.test(contents)
    ? parseCsv(contents)
    : parseAddressList(contents);
}

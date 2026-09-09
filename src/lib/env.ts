/**
 * Reading configuration from the environment, defensively.
 *
 * `process.env.X ?? fallback` is the obvious form and it is not safe. Hosting
 * dashboards store a variable that was added but left blank as an empty string,
 * not as undefined — so `??` passes it straight through, and then:
 *
 *   Number("")                  === 0      a limit of zero: refuse everything
 *   new URL("/api", "")         throws     every lookup fails
 *   headers: { "User-Agent": "" }          a request some services reject
 *
 * Each of those fails on a deployment while working perfectly in development,
 * with no error naming the cause. Treat blank as "not set" everywhere.
 */

/** A non-empty string, or the fallback. */
export function envString(raw: string | undefined, fallback: string): string {
  return raw !== undefined && raw.trim() !== "" ? raw.trim() : fallback;
}

/** A positive finite number, or the fallback. */
export function envNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

/** A URL origin that actually parses, or the fallback. */
export function envUrl(raw: string | undefined, fallback: string): string {
  const value = envString(raw, fallback);
  try {
    new URL(value);
    return value;
  } catch {
    // A malformed base URL would throw on every request instead of once here.
    console.warn(`[env] ignoring unparseable URL ${JSON.stringify(raw)}`);
    return fallback;
  }
}

/** True only for an explicit affirmative; anything blank or odd is false. */
export function envBool(raw: string | undefined, fallback = false): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === "yes";
}

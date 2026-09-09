import type { Problem } from "./schema";

/**
 * "View as API request" — the exact call the UI just made.
 *
 * This is the conversion path from someone planning one route today to someone
 * integrating the API, and it keeps the documentation honest: the snippet is
 * generated from the same object that was posted, so it cannot drift from what
 * the app actually sends the way a hand-written example would.
 */

/**
 * Wrap a string for a POSIX shell in single quotes.
 *
 * Single quotes take everything literally, which is what a JSON body needs —
 * except that a single quote cannot appear inside them. The usual dance is to
 * close the quoting, emit an escaped quote, and reopen: '\'' . Stop labels are
 * user text, so "O'Brien" reaches here regularly; getting this wrong produces a
 * snippet that fails with a shell syntax error when someone pastes it.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface ApiRequest {
  method: "POST";
  url: string;
  body: string;
  curl: string;
}

/** The solve call, as JSON and as a runnable command. */
export function solveRequest(origin: string, problem: Problem): ApiRequest {
  const url = `${origin.replace(/\/$/, "")}/api/v1/solve`;
  const body = JSON.stringify(problem, null, 2);

  const curl = [
    `curl -X POST ${shellQuote(url)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellQuote(body)}`,
  ].join("\n");

  return { method: "POST", url, body, curl };
}

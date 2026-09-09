import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";
import { ProblemSchema, SolutionSchema, type Problem, type Solution } from "./schema";

/**
 * Share links are the persistence layer in v1. There is no database, so the URL
 * carries the plan.
 *
 * The payload is versioned from the first link. Once someone has a URL, changing
 * the format breaks it — and it will be sitting in a WhatsApp thread six months
 * from now. Bumping PAYLOAD_VERSION and branching in decode() is much cheaper
 * than telling a user their link is dead.
 *
 * Phase 5 should move payloads server-side behind a short id. Keep decode()
 * working for old inline links when that happens.
 */
const PAYLOAD_VERSION = 1;
const PREFIX = `v${PAYLOAD_VERSION}.`;

/** Practical ceiling before URLs get unwieldy in messaging apps. */
export const MAX_PAYLOAD_CHARS = 8000;

interface SharePayload {
  p: Problem;
  s: Solution;
  /** Unix seconds. Lets the viewer say how old a plan is. */
  t: number;
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const b64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export class ShareError extends Error {
  constructor(
    public code: "TOO_LARGE" | "MALFORMED" | "UNSUPPORTED_VERSION",
    message: string,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

export function encodeShare(problem: Problem, solution: Solution): string {
  const payload: SharePayload = {
    p: problem,
    s: solution,
    t: Math.floor(Date.now() / 1000),
  };

  const compressed = gzipSync(strToU8(JSON.stringify(payload)), { level: 9 });
  const encoded = PREFIX + toBase64Url(compressed);

  if (encoded.length > MAX_PAYLOAD_CHARS) {
    throw new ShareError(
      "TOO_LARGE",
      "This plan is too large to share as a link. Export the manifest instead.",
    );
  }

  return encoded;
}

export function decodeShare(token: string): {
  problem: Problem;
  solution: Solution;
  createdAt: Date;
} {
  const dot = token.indexOf(".");
  if (dot === -1) {
    throw new ShareError("MALFORMED", "This link is incomplete or was cut off.");
  }

  const version = Number(token.slice(1, dot));
  const body = token.slice(dot + 1);

  if (version !== 1) {
    throw new ShareError(
      "UNSUPPORTED_VERSION",
      "This link was made by a newer version of RoutePlan.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(gunzipSync(fromBase64Url(body))));
  } catch {
    throw new ShareError("MALFORMED", "This link is incomplete or was cut off.");
  }

  const payload = parsed as SharePayload;

  // Re-validate on the way in. A share link is untrusted input: it may have been
  // hand-edited, truncated by a messaging app, or produced by an older build.
  const problem = ProblemSchema.parse(payload.p);
  const solution = SolutionSchema.parse(payload.s);

  return {
    problem,
    solution,
    createdAt: new Date((payload.t ?? 0) * 1000),
  };
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/r/${token}`;
}

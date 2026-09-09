import { NextResponse } from "next/server";
import {
  RATE_LIMITS,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { z } from "zod";
import { ProblemSchema, SolutionSchema } from "@/lib/schema";
import { MAX_PAYLOAD_CHARS, ShareError, encodeShare, shareUrl } from "@/lib/share";

export const runtime = "nodejs";

/**
 * Turn a solved plan into a link.
 *
 * The share link is the entire persistence layer in v1 — there is no database,
 * so the URL carries the plan. That is why the payload is versioned from the
 * very first link: once someone has a URL it will be sitting in a WhatsApp
 * thread six months from now, and breaking it is not an option.
 *
 * The encoding is isomorphic and could run in the browser. It lives behind an
 * endpoint anyway, because Phase 5 moves payloads server-side behind a short
 * id: when that happens this route changes and the client does not.
 */

const RequestSchema = z.object({
  problem: ProblemSchema,
  solution: SolutionSchema,
});

type ErrorCode = "INVALID_REQUEST" | "TOO_LARGE" | "INTERNAL";

function fail(code: ErrorCode, message: string, status: number, detail?: unknown) {
  return NextResponse.json({ error: { code, message, detail } }, { status });
}

/**
 * The origin to build links against.
 *
 * Behind a proxy the request URL is the internal address, which would produce
 * links that work in staging and point at nothing in production. Forwarded
 * headers win when present.
 */
function originOf(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(request: Request) {
  /*
   * No auth in v1 by design, so this is the only thing bounding cost. Checked
   * before the body is even read: a blocked caller should be cheap to refuse.
   */
  const limit = checkRateLimit(clientKey(request), RATE_LIMITS.share);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Wait ${limit.retryAfterSeconds}s and try again.`,
        },
      },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_REQUEST", "The request body isn't valid JSON.", 400);
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "INVALID_REQUEST",
      "Send the problem and the solution you want to share.",
      400,
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }

  try {
    const token = encodeShare(parsed.data.problem, parsed.data.solution);
    return NextResponse.json(
      {
        token,
        url: shareUrl(originOf(request), token),
        length: token.length,
        maxLength: MAX_PAYLOAD_CHARS,
      },
      { headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof ShareError) {
      // TOO_LARGE is the only one reachable here, and it is a real ceiling
      // rather than a bug: some plans genuinely do not fit in a URL.
      return fail("TOO_LARGE", err.message, 413);
    }
    console.error("[share] unexpected failure:", err);
    return fail("INTERNAL", "Couldn't build a link for this plan. Try again.", 500);
  }
}

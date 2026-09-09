import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * The CSP is load-bearing rather than decorative: we are pinned to maplibre-gl
 * 4.7.1 because 6.x will not render the basemap, and that version carries an
 * unfixed sanitiser bypass (GHSA-jrc7-96c5-q579). Nothing in this codebase
 * hands MapLibre markup — dom-safety.test.ts enforces that — and this policy is
 * a second, independent barrier in front of the same hole.
 *
 * It has to live in middleware rather than in next.config's headers() because
 * Next delivers its hydration payload as inline <script> blocks. A static
 * policy can only permit those with 'unsafe-inline', which would also permit an
 * injected onerror handler — precisely the thing being defended against. A
 * fresh nonce per request allows Next's own scripts and nothing else.
 *
 * 'strict-dynamic' lets those nonce-approved scripts load the app's chunks
 * without every URL being enumerated here.
 */

const isDev = process.env.NODE_ENV !== "production";

/** Hosts the browser is allowed to talk to: tiles, routing, geocoding. */
function connectSources(): string[] {
  const configured = [
    process.env.OSRM_BASE_URL,
    process.env.GEOCODER_BASE_URL,
    process.env.NEXT_PUBLIC_BASEMAP_STYLE,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => value !== null);

  return Array.from(
    new Set([
      "'self'",
      "https://tiles.openfreemap.org",
      "https://basemaps.cartocdn.com",
      "https://photon.komoot.io",
      "https://nominatim.openstreetmap.org",
      "https://router.project-osrm.org",
      ...configured,
      // Dev only: the HMR socket.
      ...(isDev ? ["ws:", "wss:"] : []),
    ]),
  );
}

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    /*
     * 'unsafe-eval' is needed in development, where the dev server compiles and
     * evaluates modules on the fly. It is deliberately absent in production.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ""}`.trim(),
    "worker-src 'self' blob:",
    // next/font inlines @font-face rules; there is no nonce path for those.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources().join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Next reads this and stamps the nonce onto the script tags it emits.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/*
 * Note for anyone adding a page: a nonce-based CSP requires the page to be
 * rendered per request. A statically prerendered page has no nonce and every
 * script on it will be blocked — a blank screen in production that development
 * never reproduces. Add `export const dynamic = "force-dynamic"` to any new
 * page, or move to a hash-based policy.
 */
export const config = {
  /*
   * Skip static assets and image optimisation: they are not documents, they
   * cannot execute script, and running middleware on every chunk is pure cost.
   */
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

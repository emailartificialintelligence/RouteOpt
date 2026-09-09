import type { NextConfig } from "next";

/**
 * Static security headers.
 *
 * The Content-Security-Policy is NOT here — it needs a per-request nonce, so it
 * is set in src/middleware.ts. A static CSP could only allow Next's inline
 * hydration scripts via 'unsafe-inline', which would also allow an injected
 * event handler and defeat the point. See MAPLIBRE_VERSION.md for why the
 * policy matters.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /*
   * Standalone output is for the Docker path only (see DEPLOY.md): it traces
   * the exact files the server needs so the image carries no package manager
   * and no source tree.
   *
   * Vercel does its own tracing and does not want this, so it is opt-in via
   * DOCKER_BUILD=1 rather than always on.
   */
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // A stray lockfile above this directory makes Next infer the wrong workspace
  // root, which silently changes what gets traced into a build. Pin it.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;

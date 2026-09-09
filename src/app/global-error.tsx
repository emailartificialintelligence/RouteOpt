"use client";

/**
 * The last resort: an error in the root layout itself, where the app's own
 * styles and fonts may not have loaded. Everything here is inline, because
 * nothing else can be relied on.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "60px 20px",
          background: "#FBFAF7",
          color: "#101B2E",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1 style={{ fontSize: 26, margin: "0 0 10px" }}>RoutePlan didn&apos;t load.</h1>
          <p style={{ color: "#55606E", lineHeight: 1.6 }}>
            Something failed before the page could start. Reloading usually
            fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 18,
              padding: "10px 18px",
              border: "1px solid #0B5D8A",
              borderRadius: 2,
              background: "#0B5D8A",
              color: "#FBFAF7",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

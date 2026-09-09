# Why maplibre-gl is pinned to 4.7.1

`npm audit` reports a **critical** advisory against maplibre-gl <= 6.4.0:
GHSA-jrc7-96c5-q579, an XSS sanitiser bypass in `DOM.sanitize()`. The fix is in
6.8.0, so the audit wants us on 6.x. We are on 4.7.1 anyway. This file exists so
that decision is not silently inherited by whoever reads the audit next.

## 6.8.0 does not render the basemap

Confirmed in desktop Chrome, not only in CI. On 6.8.0, with the map container
correctly sized at construction (920x720, canvas 1840x1440):

- the style JSON, the TileJSON and both sprite files fetch with 200s
- **no vector tile is ever requested**
- `isStyleLoaded()` stays `false` indefinitely and **no source caches are
  created**, with no `error` event emitted
- `setStyle()` against a correctly sized container does not recover it

The rest of the map layer works on 6.8.0 — markers render, the depot pin draws,
the scale and navigation controls behave. It is specifically the tiles.

On 4.7.1, changing nothing else, the basemap renders and the source cache
populates (9 tiles at zoom 11 over Paris).

Theories tested and eliminated:

- *Workers are blocked.* No — classic and module blob workers both round-trip.
- *The map was built at 0x0 and never recovered.* No — construction is deferred
  until the container is measurable (see `MapCanvas.tsx`), and 6.8.0 still
  fails with a correctly sized container.
- *Something about the sandboxed dev browser.* No — reproduced in normal Chrome.

Worth reporting upstream.

## Why 4.7.1 is safe here, for now

The advisory needs untrusted HTML to reach MapLibre's HTML-accepting APIs, and
this codebase uses none of them:

- markers are built with `textContent`, never `innerHTML`
- there are no `Popup`s and no calls to `setHTML`
- the only user-supplied strings reaching the map are marker `title` and
  `aria-label`, set as properties, not parsed as markup

So the vulnerable path is unreachable as the code stands.

## When that stops being true

**Phase 3 and 4.** They add popups, and share links carry attacker-controllable
stop labels straight into the map. A malicious share URL plus a popup that
renders a label as HTML is exactly the shape this advisory describes.

Before building popups, do one of:

1. re-test the then-current maplibre 6.x and move if the basemap renders
2. keep 4.7.1 and render popup content with `textContent` / a React portal,
   never `setHTML` — and add a test that fails if `setHTML` appears in the
   codebase

## Changing the version

    npm install maplibre-gl@^6

then change the import at the top of `src/components/MapCanvas.tsx` from the
default export to named exports:

    import { MapLibreMap, Marker, NavigationControl, ScaleControl } from "maplibre-gl";

Delete `.next` after any version change — a stale webpack cache resolves the old
entry point and fails with `ENOENT: maplibre-gl.mjs`.

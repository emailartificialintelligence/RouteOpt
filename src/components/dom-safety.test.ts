import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Two DOM rules this codebase must not break, enforced as tests because both
 * failures are invisible in review and expensive in production.
 *
 * 1. Never assign `className` on a map marker. MapLibre puts
 *    `maplibregl-marker` on the element itself and that class carries
 *    `position: absolute`. Overwriting className strips it: markers drop into
 *    normal document flow, stack in a vertical column, and stop tracking pan
 *    and zoom. The symptom looks like a coordinate bug, so it sends you
 *    hunting in the wrong file.
 *
 * 2. Never hand HTML to MapLibre. From Phase 4 a share link carries stop
 *    labels supplied by whoever built the URL, and /r/[payload] renders them.
 *    We are pinned to maplibre-gl 4.7.1, which has an unfixed sanitiser bypass
 *    (GHSA-jrc7-96c5-q579), so a label reaching setHTML turns a pasted link
 *    into an XSS. React escapes text by default; setHTML and innerHTML opt out
 *    of that, and there is no reason to.
 */

const COMPONENT_DIR = join(process.cwd(), "src/components");

function sourceFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [{ path: full, text: readFileSync(full, "utf8") }];
  });
}

const files = sourceFiles(COMPONENT_DIR);

function offenders(pattern: RegExp): string[] {
  return files.flatMap(({ path, text }) =>
    text
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => pattern.test(line))
      .map(({ line, n }) => `${path.replace(process.cwd() + "/", "")}:${n}  ${line}`),
  );
}

describe("map marker DOM handling", () => {
  it("never assigns className on an element", () => {
    expect(
      offenders(/\.className\s*=[^=]/),
      "Use classList.add/toggle. Assigning className strips maplibregl-marker, " +
        "which positions the marker; pins then stack in document flow.",
    ).toEqual([]);
  });

  it("uses classList to carry marker state", () => {
    const map = readFileSync(join(COMPONENT_DIR, "MapCanvas.tsx"), "utf8");
    expect(map).toMatch(/classList\.toggle\(\s*"marker--review"/);
    expect(map).toMatch(/classList\.toggle\(\s*"marker--selected"/);
  });
});

describe("untrusted content never becomes markup", () => {
  it("never calls setHTML", () => {
    // Share links carry attacker-controllable labels straight into this app.
    expect(
      offenders(/\.setHTML\s*\(/),
      "Build popup content as DOM with textContent, or render it in React. " +
        "setHTML on maplibre-gl 4.7.1 is an XSS vector from a shared URL.",
    ).toEqual([]);
  });

  it("never assigns innerHTML", () => {
    expect(offenders(/\.innerHTML\s*=[^=]/)).toEqual([]);
  });

  it("never uses dangerouslySetInnerHTML", () => {
    expect(offenders(/dangerouslySetInnerHTML/)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_INPUT_LINES,
  checkCoordinate,
  looksLikeHeader,
  parseAddressList,
  parseCsv,
  parseUpload,
  splitCsvLine,
  stripListDecoration,
} from "./parse";

/**
 * Parsing is where a stop goes missing without anyone noticing. Every test here
 * is either "this line must survive" or "this line must produce a visible
 * issue" — silence is the failure mode, not an exception.
 */

describe("stripListDecoration", () => {
  it("removes pasted list numbering and bullets", () => {
    expect(stripListDecoration("1. 10 Downing Street")).toBe("10 Downing Street");
    expect(stripListDecoration("12) 10 Downing Street")).toBe("10 Downing Street");
    expect(stripListDecoration("- 10 Downing Street")).toBe("10 Downing Street");
    expect(stripListDecoration("• 10 Downing Street")).toBe("10 Downing Street");
  });

  it("leaves a house number alone", () => {
    // The whole risk of this function: "10 Downing Street" must not become
    // "Downing Street", which geocodes to a different point on the street.
    expect(stripListDecoration("10 Downing Street")).toBe("10 Downing Street");
    expect(stripListDecoration("221B Baker Street")).toBe("221B Baker Street");
    expect(stripListDecoration("4 Privet Drive")).toBe("4 Privet Drive");
  });
});

describe("checkCoordinate", () => {
  it("accepts a real point", () => {
    expect(checkCoordinate(48.8566, 2.3522)).toEqual({ ok: true, looksSwapped: false });
  });

  it("spots the lng,lat ordering mistake", () => {
    // 151.2 is a valid longitude but not a latitude: Sydney entered backwards.
    expect(checkCoordinate(151.2093, -33.8688)).toEqual({
      ok: false,
      looksSwapped: true,
    });
  });

  it("rejects a pair that is wrong either way round", () => {
    expect(checkCoordinate(999, 999)).toEqual({ ok: false, looksSwapped: false });
  });
});

describe("parseAddressList", () => {
  it("takes one address per line, whole line", () => {
    const { rows, issues } = parseAddressList(
      "10 Downing Street, London\n221B Baker Street, London",
    );
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "address",
      address: "10 Downing Street, London",
      line: 1,
    });
  });

  it("does not split an address on its commas", () => {
    // The paste panel must never guess that the first comma separates a label.
    const { rows } = parseAddressList("Acme Corp, 10 Downing Street, London");
    expect(rows[0]).toMatchObject({
      kind: "address",
      address: "Acme Corp, 10 Downing Street, London",
    });
    expect(rows[0].label).toBeUndefined();
  });

  it("skips blank lines without counting them as stops", () => {
    const { rows } = parseAddressList("A road\n\n  \nB road\n");
    expect(rows).toHaveLength(2);
    expect(rows[1].line).toBe(4);
  });

  it("reads a bare coordinate pair literally", () => {
    const { rows } = parseAddressList("48.8566, 2.3522\n48.8606 2.3376");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "coordinate", lat: 48.8566, lng: 2.3522 });
    expect(rows[1]).toMatchObject({ kind: "coordinate", lat: 48.8606, lng: 2.3376 });
  });

  it("flags a swapped pair instead of dropping it", () => {
    const { rows, issues } = parseAddressList("151.2093, -33.8688");
    expect(rows).toHaveLength(0);
    expect(issues[0].reason).toMatch(/wrong way round/i);
    expect(issues[0].line).toBe(1);
  });

  it("keeps duplicate addresses", () => {
    // Two deliveries to the same building is normal. Silently merging them
    // loses a job.
    const { rows } = parseAddressList("Same place\nSame place");
    expect(rows).toHaveLength(2);
  });

  it("reports lines past the input ceiling rather than truncating quietly", () => {
    const input = Array.from({ length: MAX_INPUT_LINES + 3 }, (_, i) => `Road ${i}`).join("\n");
    const { rows, issues } = parseAddressList(input);
    expect(rows).toHaveLength(MAX_INPUT_LINES);
    expect(issues).toHaveLength(3);
    expect(issues[0].reason).toMatch(/limit/i);
  });

  it("strips quotes a spreadsheet added", () => {
    const { rows } = parseAddressList('"10 Downing Street, London"');
    expect(rows[0]).toMatchObject({ address: "10 Downing Street, London" });
  });
});

describe("splitCsvLine", () => {
  it("respects quoted commas", () => {
    expect(splitCsvLine('"Smith, John",10 Downing Street')).toEqual([
      "Smith, John",
      "10 Downing Street",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('"The ""Old"" Mill",Kent')).toEqual(['The "Old" Mill', "Kent"]);
  });

  it("accepts semicolons and tabs, which is what Excel exports abroad", () => {
    expect(splitCsvLine("Acme;10 Downing Street")).toEqual(["Acme", "10 Downing Street"]);
    expect(splitCsvLine("Acme\t10 Downing Street")).toEqual(["Acme", "10 Downing Street"]);
  });
});

describe("looksLikeHeader", () => {
  it("recognises column names", () => {
    expect(looksLikeHeader(["label", "address"])).toBe(true);
    expect(looksLikeHeader(["name", "lat", "lng"])).toBe(true);
  });

  it("does not mistake a real row for a header", () => {
    expect(looksLikeHeader(["Acme Corp", "10 Downing Street"])).toBe(false);
  });
});

describe("parseCsv", () => {
  it("reads label,address", () => {
    const { rows, issues } = parseCsv("Acme,10 Downing Street\nBeta,221B Baker Street");
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({
      kind: "address",
      label: "Acme",
      address: "10 Downing Street",
    });
  });

  it("reads label,lat,lng", () => {
    const { rows } = parseCsv("Acme,48.8566,2.3522");
    expect(rows[0]).toMatchObject({
      kind: "coordinate",
      label: "Acme",
      lat: 48.8566,
      lng: 2.3522,
    });
  });

  it("drops a header row", () => {
    const { rows } = parseCsv("label,address\nAcme,10 Downing Street");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Acme" });
  });

  it("handles a file that mixes geocoded and un-geocoded rows", () => {
    // A half-finished spreadsheet is the normal case, not the edge case.
    const { rows } = parseCsv("Acme,48.8566,2.3522\nBeta,221B Baker Street");
    expect(rows[0].kind).toBe("coordinate");
    expect(rows[1].kind).toBe("address");
  });

  it("rejoins an address that had commas in it", () => {
    const { rows } = parseCsv("Acme,10 Downing Street,London,SW1A 2AA");
    expect(rows[0]).toMatchObject({
      kind: "address",
      label: "Acme",
      address: "10 Downing Street, London, SW1A 2AA",
    });
  });

  it("flags a swapped coordinate row with its line number", () => {
    const { rows, issues } = parseCsv("Acme,10 Downing Street\nBeta,151.2093,-33.8688");
    expect(rows).toHaveLength(1);
    expect(issues[0].line).toBe(2);
    expect(issues[0].reason).toMatch(/wrong way round/i);
  });

  it("treats a single column as an address list", () => {
    const { rows } = parseCsv("10 Downing Street\n221B Baker Street");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "address", address: "10 Downing Street" });
  });
});

describe("parseUpload", () => {
  it("uses CSV rules for a delimited .csv", () => {
    const { rows } = parseUpload("stops.csv", "Acme,48.8566,2.3522");
    expect(rows[0].kind).toBe("coordinate");
  });

  it("falls back to one-per-line for a plain text file", () => {
    const { rows } = parseUpload("stops.txt", "10 Downing Street\n221B Baker Street");
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("address");
  });
});

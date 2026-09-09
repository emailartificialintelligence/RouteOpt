import { describe, expect, it } from "vitest";
import {
  assessCandidates,
  classifyPrecision,
  photonDisplayName,
  photonToCandidates,
  type GeocodeCandidate,
} from "./geocode";

/**
 * The trap these guard is the quiet one: Nominatim answers every query, so a
 * bad match arrives looking exactly like a good one. Precision is the only
 * signal that separates "the driver's parking spot" from "the middle of
 * Belgium", and it has to be conservative — an unrecognised type must degrade
 * to "area" and get a human's attention, never default to precise.
 */

function candidate(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    lat: 48.8566,
    lng: 2.3522,
    displayName: "10 Downing Street, London",
    precision: "exact",
    ...over,
  };
}

describe("classifyPrecision", () => {
  it("treats a house number as exact regardless of type", () => {
    expect(classifyPrecision("village", "place", true)).toBe("exact");
  });

  it("recognises buildings", () => {
    expect(classifyPrecision("house", "building", false)).toBe("exact");
    expect(classifyPrecision("office", "office", false)).toBe("exact");
  });

  it("recognises roads as street-level", () => {
    expect(classifyPrecision("road", "highway", false)).toBe("street");
    expect(classifyPrecision("residential", "highway", false)).toBe("exact");
    expect(classifyPrecision(undefined, "highway", false)).toBe("street");
  });

  it("treats towns and countries as areas", () => {
    expect(classifyPrecision("city", "place", false)).toBe("area");
    expect(classifyPrecision("country", "place", false)).toBe("area");
    expect(classifyPrecision("suburb", "place", false)).toBe("area");
  });

  it("degrades an unknown type to area rather than trusting it", () => {
    // The safe default is the one that makes a human look at the pin.
    expect(classifyPrecision("something_new", undefined, false)).toBe("area");
    expect(classifyPrecision(undefined, undefined, false)).toBe("area");
  });
});

describe("assessCandidates", () => {
  it("passes a single precise match", () => {
    const result = assessCandidates("10 Downing Street", [candidate()]);
    expect(result.status).toBe("ok");
    expect(result.note).toBeUndefined();
  });

  it("reports nothing found with a fixable instruction", () => {
    const result = assessCandidates("asdfgh", []);
    expect(result.status).toBe("not_found");
    expect(result.candidates).toEqual([]);
    expect(result.note).toMatch(/postcode|spelling/i);
  });

  it("collapses repeats of the same building into one match", () => {
    // Nominatim often returns the same place several times. Calling that
    // "ambiguous" would send the user to confirm a choice that does not exist.
    const result = assessCandidates("10 Downing Street", [
      candidate(),
      candidate({ lat: 48.85661, lng: 2.35221, displayName: "10 Downing St" }),
      candidate({ lat: 48.85662, lng: 2.35219 }),
    ]);
    expect(result.status).toBe("ok");
    expect(result.candidates).toHaveLength(1);
  });

  it("asks the user to choose between genuinely different places", () => {
    const result = assessCandidates("Springfield", [
      candidate({ lat: 39.78, lng: -89.65, displayName: "Springfield, Illinois" }),
      candidate({ lat: 42.1, lng: -72.59, displayName: "Springfield, Massachusetts" }),
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.note).toMatch(/pick/i);
  });

  it("flags a lone area match as needing a look", () => {
    // This is the wrong-country failure. One result, no error, and useless for
    // delivery — so it must not come back as "ok".
    const result = assessCandidates("10 Downing Street", [
      candidate({ precision: "area", displayName: "United Kingdom" }),
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.note).toMatch(/area/i);
  });

  it("accepts a street match but says the number is missing", () => {
    const result = assessCandidates("Downing Street", [
      candidate({ precision: "street" }),
    ]);
    expect(result.status).toBe("ok");
    expect(result.note).toMatch(/number/i);
  });

  it("keeps the best candidate first", () => {
    const result = assessCandidates("Springfield", [
      candidate({ lat: 39.78, lng: -89.65, displayName: "Springfield, Illinois" }),
      candidate({ lat: 42.1, lng: -72.59, displayName: "Springfield, Massachusetts" }),
    ]);
    expect(result.candidates[0].displayName).toMatch(/Illinois/);
  });
});

describe("photon provider", () => {
  /** The shape photon.komoot.io actually returns, verified against the live API. */
  const feature = (over: Record<string, unknown> = {}, coords = [2.3748, 48.8443]) => ({
    geometry: { coordinates: coords as [number, number] },
    properties: {
      name: "Gare de Lyon",
      housenumber: "4",
      street: "Rue Van Gogh",
      city: "Paris",
      postcode: "75012",
      country: "France",
      type: "house",
      osm_key: "building",
      ...over,
    },
  });

  it("reads GeoJSON coordinates as [lng, lat], not the reverse", () => {
    // Reading them backwards is the classic way to put a stop in the sea.
    const [c] = photonToCandidates([feature({}, [2.3748, 48.8443])]);
    expect(c.lat).toBeCloseTo(48.8443, 4);
    expect(c.lng).toBeCloseTo(2.3748, 4);
  });

  it("treats a house number as exact, matching the Nominatim path", () => {
    // Swapping provider must not quietly change how strict the warning is.
    expect(photonToCandidates([feature()])[0].precision).toBe("exact");
  });

  it("treats a country as an area, so the UI still says check the pin", () => {
    const [c] = photonToCandidates([
      feature({ name: "Belgium", housenumber: undefined, street: undefined, type: "country", osm_key: "place" }),
    ]);
    expect(c.precision).toBe("area");
  });

  it("drops features with no usable coordinates", () => {
    const broken = { geometry: {}, properties: { name: "Nowhere" } };
    expect(photonToCandidates([broken])).toHaveLength(0);
  });

  it("builds a display name that reads like an address", () => {
    expect(photonDisplayName(feature().properties)).toBe(
      "Gare de Lyon, 4 Rue Van Gogh, 75012, Paris, France",
    );
  });

  it("does not repeat the name when it is just the street", () => {
    const name = photonDisplayName({ name: "Rue Van Gogh", street: "Rue Van Gogh", city: "Paris" });
    expect(name).toBe("Rue Van Gogh, Paris");
  });

  it("feeds the same ambiguity rules as Nominatim", () => {
    // Five Springfields must still ask the user to choose.
    const springfields = [
      feature({ name: "Springfield", housenumber: undefined, type: "city", osm_key: "place" }, [-89.64, 39.79]),
      feature({ name: "Springfield", housenumber: undefined, type: "city", osm_key: "place" }, [-72.58, 42.10]),
    ];
    const result = assessCandidates("Springfield", photonToCandidates(springfields));
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
  });
});

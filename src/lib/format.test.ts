import { describe, expect, it } from "vitest";
import {
  formatArrival,
  formatCoordinate,
  formatDistance,
  formatDuration,
  formatSaving,
  pluralise,
} from "./format";

describe("formatDistance", () => {
  it("uses metres below a kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("uses one decimal for kilometres", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(12740)).toBe("12.7 km");
  });

  it("drops the decimal past 100 km, where it is noise", () => {
    expect(formatDistance(124_500)).toBe("125 km");
  });

  it("returns a dash rather than NaN", () => {
    // A dash in a column is legible. "NaN km" on a manifest is alarming.
    expect(formatDistance(Number.NaN)).toBe("—");
    expect(formatDistance(-5)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("rounds to whole minutes", () => {
    expect(formatDuration(45)).toBe("under a minute");
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(2700)).toBe("45 min");
  });

  it("switches to hours with padded minutes", () => {
    expect(formatDuration(3600)).toBe("1 h 00");
    expect(formatDuration(3900)).toBe("1 h 05");
    expect(formatDuration(30600)).toBe("8 h 30");
  });

  it("returns a dash rather than NaN", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatArrival", () => {
  it("counts an offset forward from the start of the shift", () => {
    expect(formatArrival(0)).toBe("09:00");
    expect(formatArrival(3600)).toBe("10:00");
    expect(formatArrival(5400)).toBe("10:30");
  });

  it("accepts a different start hour", () => {
    expect(formatArrival(0, 6)).toBe("06:00");
  });

  it("wraps past midnight instead of printing hour 25", () => {
    expect(formatArrival(16 * 3600, 9)).toBe("01:00");
  });
});

describe("formatSaving", () => {
  it("reports a real improvement", () => {
    const saving = formatSaving(12_740, 14_240);
    expect(saving?.percent).toBe(11);
    expect(saving?.text).toMatch(/11% shorter/);
  });

  it("claims nothing when the plan is not shorter", () => {
    // The product's core claim is that it beats your list order. Printing
    // "0% shorter" or a negative saving would be worse than staying quiet.
    expect(formatSaving(14_240, 14_240)).toBeNull();
    expect(formatSaving(15_000, 14_240)).toBeNull();
  });

  it("claims nothing when the gain rounds to nothing", () => {
    expect(formatSaving(9990, 10_000)).toBeNull();
  });

  it("claims nothing without a usable baseline", () => {
    expect(formatSaving(1000, 0)).toBeNull();
    expect(formatSaving(1000, Number.NaN)).toBeNull();
  });
});

describe("pluralise", () => {
  it("agrees with the count", () => {
    expect(pluralise(1, "stop")).toBe("1 stop");
    expect(pluralise(3, "stop")).toBe("3 stops");
    expect(pluralise(0, "stop")).toBe("0 stops");
  });

  it("takes an irregular plural", () => {
    expect(pluralise(2, "van", "vans")).toBe("2 vans");
  });
});

describe("formatCoordinate", () => {
  it("shows about a metre of precision, at fixed width", () => {
    // Fixed decimals keep the column aligned under tabular numerals, which is
    // what makes a drifted stop obvious at a glance.
    expect(formatCoordinate(48.8566, 2.3522)).toBe("48.85660, 2.35220");
    expect(formatCoordinate(48.123456789, 2.987654321)).toBe("48.12346, 2.98765");
  });

  it("keeps latitude first, matching what a user types", () => {
    expect(formatCoordinate(48.8566, 2.3522).startsWith("48.")).toBe(true);
  });

  it("handles the southern and western hemispheres", () => {
    expect(formatCoordinate(-33.8688, 151.2093)).toBe("-33.86880, 151.20930");
  });

  it("returns a dash rather than NaN", () => {
    expect(formatCoordinate(Number.NaN, 2.3)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { envBool, envNumber, envString, envUrl } from "./env";

/**
 * These exist because a variable added-but-left-blank in a hosting dashboard is
 * an empty string, not undefined — and `?? fallback` does not catch it. Every
 * case below was a real failure on a deployment that worked locally.
 */

describe("envString", () => {
  it("uses the fallback for unset, empty and whitespace", () => {
    expect(envString(undefined, "d")).toBe("d");
    expect(envString("", "d")).toBe("d");
    expect(envString("   ", "d")).toBe("d");
  });

  it("trims a real value", () => {
    expect(envString("  hello  ", "d")).toBe("hello");
  });
});

describe("envNumber", () => {
  it("uses the fallback for anything unusable", () => {
    // Number("") is 0, which silently became "refuse every request".
    expect(envNumber("", 60)).toBe(60);
    expect(envNumber(undefined, 60)).toBe(60);
    expect(envNumber("abc", 60)).toBe(60);
    expect(envNumber("0", 60)).toBe(60);
    expect(envNumber("-5", 60)).toBe(60);
  });

  it("accepts a real number", () => {
    expect(envNumber("25", 60)).toBe(25);
  });
});

describe("envUrl", () => {
  it("uses the fallback for empty, which would throw in new URL()", () => {
    expect(envUrl("", "https://example.com")).toBe("https://example.com");
    expect(envUrl(undefined, "https://example.com")).toBe("https://example.com");
  });

  it("uses the fallback for something that is not a URL", () => {
    // Better one warning at startup than a throw on every single request.
    expect(envUrl("not a url", "https://example.com")).toBe("https://example.com");
  });

  it("keeps a valid URL", () => {
    expect(envUrl("https://photon.komoot.io", "https://x.test")).toBe(
      "https://photon.komoot.io",
    );
  });
});

describe("envBool", () => {
  it("is false unless explicitly affirmative", () => {
    expect(envBool("")).toBe(false);
    expect(envBool(undefined)).toBe(false);
    expect(envBool("false")).toBe(false);
    expect(envBool("no")).toBe(false);
  });

  it("accepts the usual affirmatives", () => {
    expect(envBool("true")).toBe(true);
    expect(envBool("1")).toBe(true);
    expect(envBool("YES")).toBe(true);
  });
});

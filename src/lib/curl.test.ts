import { describe, expect, it } from "vitest";
import { ProblemSchema, expandVehicleCount } from "./schema";
import { shellQuote, solveRequest } from "./curl";

const DEPOT = { lat: 48.8443, lng: 2.3743 };

function problemWith(label: string) {
  return ProblemSchema.parse({
    depot: DEPOT,
    stops: [{ id: "s1", label, lat: 48.8606, lng: 2.3376 }],
    vehicles: expandVehicleCount(1),
  });
}

describe("shellQuote", () => {
  it("wraps plain text in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("survives an apostrophe, which real stop labels contain", () => {
    // "O'Brien" is an ordinary customer name. Naive quoting produces a snippet
    // that dies with a shell syntax error the moment someone pastes it.
    expect(shellQuote("O'Brien")).toBe(`'O'\\''Brien'`);
  });

  it("leaves double quotes and braces alone", () => {
    // JSON is mostly these; single quoting must not mangle them.
    expect(shellQuote('{"a":"b"}')).toBe(`'{"a":"b"}'`);
  });

  it("handles several apostrophes", () => {
    expect(shellQuote("a'b'c")).toBe(`'a'\\''b'\\''c'`);
  });
});

describe("solveRequest", () => {
  it("targets the public solve endpoint", () => {
    const req = solveRequest("https://routeplan.example", problemWith("Acme"));
    expect(req.url).toBe("https://routeplan.example/api/v1/solve");
    expect(req.method).toBe("POST");
  });

  it("does not double the slash on an origin that has one", () => {
    const req = solveRequest("https://routeplan.example/", problemWith("Acme"));
    expect(req.url).toBe("https://routeplan.example/api/v1/solve");
  });

  it("emits a body the API would accept back", () => {
    // The snippet's whole value is being the real request. If it does not
    // round-trip through the schema, it is documentation that lies.
    const problem = problemWith("Acme");
    const req = solveRequest("https://routeplan.example", problem);
    expect(ProblemSchema.safeParse(JSON.parse(req.body)).success).toBe(true);
  });

  it("produces a curl command with the JSON intact", () => {
    const req = solveRequest("https://routeplan.example", problemWith("Acme"));
    expect(req.curl).toContain("curl -X POST");
    expect(req.curl).toContain("Content-Type: application/json");
    expect(req.curl).toContain('"label": "Acme"');
  });

  it("keeps the command pasteable when a label has an apostrophe", () => {
    /*
     * The real question is whether a shell would reconstruct the original
     * string, so undo the quoting the way a shell does and compare. Counting
     * quotes cannot answer it: the escape sequence '\'' legitimately contains
     * three of them.
     */
    const shellUnquote = (quoted: string): string => {
      expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
      return quoted.slice(1, -1).split(`'\\''`).join("'");
    };

    const problem = problemWith("O'Brien");
    const req = solveRequest("https://routeplan.example", problem);

    const quotedBody = req.curl.slice(req.curl.indexOf("-d ") + 3);
    expect(JSON.parse(shellUnquote(quotedBody))).toEqual(
      JSON.parse(JSON.stringify(problem)),
    );
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { GeocodeResult } from "./geocode";
import { parseAddressList, parseCsv } from "./parse";
import { ProblemSchema, expandVehicleCount } from "./schema";
import {
  applyGeocodeResult,
  chooseCandidate,
  displayName,
  draftBounds,
  emptyDraft,
  geocodeQueryFor,
  placeStopByHand,
  resetStopIds,
  rowsToDraftStops,
  problemToDraft,
  summarise,
  type Draft,
  type DraftDepot,
  type DraftStop,
} from "./plan";

/**
 * The gate these tests defend: nothing solvable leaves the draft until every
 * stop has coordinates and a depot exists. A route computed from a draft with a
 * missing pin is a delivery that silently never happens.
 */

beforeEach(() => {
  resetStopIds();
});

function draftWith(stops: DraftStop[], depot: DraftDepot = { lat: 48.84, lng: 2.37 }): Draft {
  return { depot, stops };
}

describe("rowsToDraftStops", () => {
  it("marks pasted coordinates as hand-placed, not pending lookup", () => {
    // The user supplied the point. Sending it to a geocoder could only make it
    // worse.
    const stops = rowsToDraftStops(parseAddressList("48.8566, 2.3522").rows);
    expect(stops[0]).toMatchObject({ status: "manual", lat: 48.8566, lng: 2.3522 });
  });

  it("marks addresses as pending with no coordinates", () => {
    const stops = rowsToDraftStops(parseAddressList("10 Downing Street").rows);
    expect(stops[0]).toMatchObject({ status: "pending", lat: null, lng: null });
  });

  it("gives every stop a distinct id", () => {
    const stops = rowsToDraftStops(parseAddressList("A road\nB road\nC road").rows);
    expect(new Set(stops.map((s) => s.id)).size).toBe(3);
  });

  it("keeps ids stable when a stop is removed", () => {
    // Ids reach the manifest and share links. Renumbering on delete would
    // repoint an already-shared link at a different stop.
    const stops = rowsToDraftStops(parseAddressList("A\nB\nC").rows);
    const ids = stops.map((s) => s.id);
    const after = stops.filter((s) => s.id !== ids[1]);
    expect(after.map((s) => s.id)).toEqual([ids[0], ids[2]]);
  });

  it("carries a CSV label through", () => {
    const stops = rowsToDraftStops(parseCsv("Acme,10 Downing Street").rows);
    expect(stops[0]).toMatchObject({ label: "Acme", address: "10 Downing Street" });
  });
});

describe("geocodeQueryFor", () => {
  it("looks up the address, not the label", () => {
    const [stop] = rowsToDraftStops(parseCsv("Acme,10 Downing Street").rows);
    expect(geocodeQueryFor(stop)).toBe("10 Downing Street");
  });
});

describe("applyGeocodeResult", () => {
  const pending = (): DraftStop => rowsToDraftStops(parseAddressList("A road").rows)[0];

  const result = (over: Partial<GeocodeResult>): GeocodeResult => ({
    query: "A road",
    status: "ok",
    candidates: [
      { lat: 48.86, lng: 2.33, displayName: "A road, Paris", precision: "exact" },
    ],
    ...over,
  });

  it("places a clean match", () => {
    const stop = applyGeocodeResult(pending(), result({}));
    expect(stop).toMatchObject({ status: "located", lat: 48.86, lng: 2.33 });
  });

  it("places an ambiguous match but keeps it flagged", () => {
    // It goes on the map — the user has to see where it landed to judge it —
    // but it must not count as settled.
    const stop = applyGeocodeResult(
      pending(),
      result({ status: "ambiguous", note: "2 places match. Pick the right one." }),
    );
    expect(stop.status).toBe("review");
    expect(stop.lat).toBe(48.86);
    expect(stop.note).toMatch(/pick/i);
  });

  it("leaves a failed lookup with no coordinates", () => {
    const stop = applyGeocodeResult(
      pending(),
      result({ status: "not_found", candidates: [], note: "No match." }),
    );
    expect(stop.status).toBe("failed");
    expect(stop.lat).toBeNull();
  });
});

describe("chooseCandidate", () => {
  it("settles an ambiguous stop on the chosen point", () => {
    const stop: DraftStop = {
      id: "s1",
      address: "Springfield",
      lat: 39.78,
      lng: -89.65,
      status: "review",
      note: "2 places match. Pick the right one.",
      candidates: [
        { lat: 39.78, lng: -89.65, displayName: "Springfield, Illinois", precision: "exact" },
        { lat: 42.1, lng: -72.59, displayName: "Springfield, Massachusetts", precision: "exact" },
      ],
    };
    const chosen = chooseCandidate(stop, 1);
    expect(chosen).toMatchObject({ status: "located", lat: 42.1, lng: -72.59 });
    expect(chosen.note).toBeUndefined();
  });

  it("ignores an index that does not exist", () => {
    const stop: DraftStop = {
      id: "s1",
      lat: null,
      lng: null,
      status: "failed",
      candidates: [],
    };
    expect(chooseCandidate(stop, 3)).toBe(stop);
  });
});

describe("placeStopByHand", () => {
  it("overrides a failed lookup and clears its warning", () => {
    const stop: DraftStop = {
      id: "s1",
      address: "nowhere",
      lat: null,
      lng: null,
      status: "failed",
      note: "No match.",
    };
    const placed = placeStopByHand(stop, 48.86, 2.33);
    expect(placed).toMatchObject({ status: "manual", lat: 48.86, lng: 2.33 });
    expect(placed.note).toBeUndefined();
  });
});

describe("summarise", () => {
  const located = (id: string): DraftStop => ({
    id,
    address: `${id} road`,
    lat: 48.86,
    lng: 2.33,
    status: "located",
  });

  it("allows solving once every stop is placed and a depot is set", () => {
    const summary = summarise(draftWith([located("a"), located("b")]));
    expect(summary.canSolve).toBe(true);
    expect(summary.placed).toBe(2);
    expect(summary.blockingReasons).toEqual([]);
  });

  it("blocks with no depot", () => {
    const summary = summarise(draftWith([located("a")], { lat: null, lng: null }));
    expect(summary.canSolve).toBe(false);
    expect(summary.blockingReasons.join(" ")).toMatch(/depot/i);
  });

  it("blocks with no stops", () => {
    expect(summarise(emptyDraft()).canSolve).toBe(false);
  });

  it("blocks while a lookup is outstanding", () => {
    const pending: DraftStop = { id: "p", lat: null, lng: null, status: "pending" };
    const summary = summarise(draftWith([located("a"), pending]));
    expect(summary.canSolve).toBe(false);
    expect(summary.pending).toBe(1);
  });

  it("blocks on an unmatched address and counts it in plain words", () => {
    const failed: DraftStop = { id: "f", lat: null, lng: null, status: "failed" };
    const summary = summarise(draftWith([located("a"), failed]));
    expect(summary.canSolve).toBe(false);
    expect(summary.unplaced).toBe(1);
    expect(summary.blockingReasons.join(" ")).toMatch(/One address didn't match/);
  });

  it("does not block on a stop that only needs review", () => {
    // A flagged stop still has a pin. The confirmation step is a look, not a
    // form to complete — blocking here would make the warning useless noise.
    const review: DraftStop = {
      id: "r",
      lat: 48.9,
      lng: 2.4,
      status: "review",
      note: "Only matched an area, not a street address. Check the pin.",
    };
    const summary = summarise(draftWith([located("a"), review]));
    expect(summary.canSolve).toBe(true);
    expect(summary.needsReview).toBe(1);
  });
});

describe("draftBounds", () => {
  it("frames the depot and every placed stop", () => {
    const stops: DraftStop[] = [
      { id: "a", lat: 48.90, lng: 2.30, status: "located" },
      { id: "b", lat: 48.80, lng: 2.45, status: "located" },
    ];
    expect(draftBounds(draftWith(stops))).toEqual({
      west: 2.3,
      south: 48.8,
      east: 2.45,
      north: 48.9,
    });
  });

  it("ignores stops with no coordinates", () => {
    const stops: DraftStop[] = [
      { id: "a", lat: 48.90, lng: 2.30, status: "located" },
      { id: "b", lat: null, lng: null, status: "failed" },
    ];
    expect(draftBounds(draftWith(stops))).toEqual({
      west: 2.3,
      south: 48.84,
      east: 2.37,
      north: 48.9,
    });
  });

  it("returns null when there is nothing to frame", () => {
    // Fitting to an empty box would fly the map to null island off Africa.
    expect(draftBounds(emptyDraft())).toBeNull();
  });
});

describe("displayName", () => {
  it("does not echo a pasted coordinate as the name", () => {
    // The coordinates get their own line in the list. Falling back to the raw
    // source text here would print them twice on every hand-placed stop.
    const [stop] = rowsToDraftStops(parseAddressList("48.8566, 2.3522").rows);
    expect(displayName(stop, 0)).toBe("Stop 1");
  });

  it("prefers the label, then the address, then a number", () => {
    expect(displayName({ id: "a", label: "Acme", lat: null, lng: null, status: "pending" }, 0)).toBe("Acme");
    expect(displayName({ id: "a", address: "A road", lat: null, lng: null, status: "pending" }, 0)).toBe("A road");
    expect(displayName({ id: "a", lat: null, lng: null, status: "pending" }, 4)).toBe("Stop 5");
  });
});

describe("problemToDraft", () => {
  const problem = ProblemSchema.parse({
    depot: { lat: 48.8443, lng: 2.3743, label: "Yard", address: "1 Depot Road" },
    stops: [
      { id: "a", label: "Acme", address: "10 Downing Street", lat: 48.86, lng: 2.33 },
      { id: "b", lat: 48.85, lng: 2.35 },
    ],
    vehicles: expandVehicleCount(2),
  });

  it("brings every stop back placed", () => {
    // A Problem cannot contain a stop without coordinates, so nothing in a
    // shared plan is ever pending or unmatched.
    const draft = problemToDraft(problem);
    expect(draft.stops).toHaveLength(2);
    expect(draft.stops.every((s) => s.status === "located")).toBe(true);
    expect(draft.stops.every((s) => s.lat !== null && s.lng !== null)).toBe(true);
  });

  it("keeps ids, so the solution's stopIds still line up", () => {
    expect(problemToDraft(problem).stops.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("carries labels and addresses through", () => {
    const [first] = problemToDraft(problem).stops;
    expect(first).toMatchObject({ label: "Acme", address: "10 Downing Street" });
  });

  it("restores the depot", () => {
    expect(problemToDraft(problem).depot).toMatchObject({
      label: "Yard",
      lat: 48.8443,
      lng: 2.3743,
    });
  });

  it("produces a draft that is immediately solvable", () => {
    // The read-only view offers "plan your own from this"; that only works if
    // the rehydrated draft passes the same readiness gate as a fresh one.
    expect(summarise(problemToDraft(problem)).canSolve).toBe(true);
  });
});

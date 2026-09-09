"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ApiError,
  fetchCapabilities,
  fetchRouteGeometries,
  geocodeAddresses,
  solveProblem,
  type SolverInfo,
} from "@/lib/api-client";
import type { Problem, Solution } from "@/lib/schema";
import {
  defaultPlanOptions,
  draftToProblem,
  routePath,
  type PlanOptions,
} from "@/lib/routes";
import type { GeocodeResult } from "@/lib/geocode";
import { checkCoordinate, parseAddressList, parseUpload, type ParseIssue } from "@/lib/parse";
import {
  applyGeocodeResult,
  chooseCandidate,
  emptyDraft,
  geocodeQueryFor,
  nextStopId,
  placeStopByHand,
  rowsToDraftStops,
  summarise,
  type Draft,
  type DraftStop,
} from "@/lib/plan";
import { DEMO_DRAFT } from "@/lib/demo";
import { StopList } from "./StopList";
import { PlanControls } from "./PlanControls";
import { RouteSummary } from "./RouteSummary";
import { SharePanel } from "./SharePanel";
import { DownloadPanel } from "./DownloadPanel";
import { EngineComparison } from "./EngineComparison";
import type { DrawnRoute, MapMode } from "./MapCanvas";
import styles from "./Planner.module.css";

/**
 * One screen: paste, confirm, and (from the next phase) plan.
 *
 * All the real logic lives in src/lib as pure functions — parsing, the draft
 * model, readiness. This component owns state and side effects and nothing
 * else, which is why the rules about what may be solved are testable without
 * rendering anything.
 */

/*
 * MapLibre touches window at import time, so it cannot be server-rendered. The
 * placeholder is the map's own background rather than a spinner: something that
 * flashes a loading state on every visit is worse than something that is simply
 * there a beat later.
 */
const MapCanvas = dynamic(
  () => import("./MapCanvas").then((m) => m.MapCanvas),
  { ssr: false, loading: () => <div style={{ position: "absolute", inset: 0 }} /> },
);

export function Planner() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pasteText, setPasteText] = useState("");
  const [depotQuery, setDepotQuery] = useState("");
  const [mode, setMode] = useState<MapMode>("idle");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [planOptions, setPlanOptions] = useState<PlanOptions>(defaultPlanOptions);
  const [solvers, setSolvers] = useState<SolverInfo[]>([]);
  const [solving, setSolving] = useState(false);
  const [plan, setPlan] = useState<{ problem: Problem; solution: Solution } | null>(null);
  const [drawnRoutes, setDrawnRoutes] = useState<DrawnRoute[]>([]);
  /** Bumped once per solve, so the map replays its reveal only for a new plan. */
  const [planId, setPlanId] = useState(0);
  /*
   * Bumped only when the viewport should re-frame: a pasted list, a CSV, a
   * depot lookup. Deliberately not bumped when a pin is clicked onto the map or
   * dragged — re-framing then moves the view out from under the user's hand and
   * makes the pins look as though they are drifting.
   */
  const [fitRequest, setFitRequest] = useState(0);
  const requestFit = useCallback(() => setFitRequest((n) => n + 1), []);
  const [copied, setCopied] = useState(false);
  /*
   * One level of undo for the destructive actions.
   *
   * Clear wipes a round somebody may have spent minutes pasting and correcting,
   * and there is no database to recover it from — the work exists only in this
   * tab. A confirmation dialog would ask about every deletion including the
   * trivial ones; an undo asks about none and still saves the expensive
   * mistake.
   */
  const [undo, setUndo] = useState<{ draft: Draft; label: string } | null>(null);

  const summary = useMemo(() => summarise(draft), [draft]);

  /* -------------------------------------------------------------- geocoding */

  /**
   * Look up a set of stops and fold each batch into state as it lands.
   *
   * Results are matched back to stops by id, never by position: the user can
   * delete a stop or drag a pin while the lookups are still running, and
   * matching by index would then write a coordinate onto the wrong delivery.
   */
  const locate = useCallback(async (targets: DraftStop[]) => {
    const pending = targets.filter((s) => s.status === "pending");
    if (pending.length === 0) return;

    const ids = pending.map((s) => s.id);
    const queries = pending.map(geocodeQueryFor);

    setError(null);
    setProgress({ done: 0, total: queries.length });

    let offset = 0;
    try {
      await geocodeAddresses(queries, (results, reported) => {
        const slice = ids.slice(offset, offset + results.length);
        offset += results.length;

        const byId = new Map<string, GeocodeResult>();
        slice.forEach((id, i) => byId.set(id, results[i]));

        setDraft((current) => ({
          ...current,
          stops: current.stops.map((stop) => {
            const result = byId.get(stop.id);
            return result ? applyGeocodeResult(stop, result) : stop;
          }),
        }));
        setProgress(reported);
        requestFit();
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the address lookup. Check your connection and try again.",
      );
      // Anything still pending will never resolve on its own. Mark it so the
      // readiness summary stops claiming work is in flight.
      setDraft((current) => ({
        ...current,
        stops: current.stops.map((stop) =>
          ids.includes(stop.id) && stop.status === "pending"
            ? { ...stop, status: "failed", note: "Lookup didn't finish. Try again, or place this stop on the map." }
            : stop,
        ),
      }));
    } finally {
      setProgress(null);
    }
  }, [requestFit]);

  /* ---------------------------------------------------------------- solving */

  /*
   * The solver list comes from the API, never from a constant in here. The
   * engines and their descriptions are the server's business; hardcoding them
   * would mean the selector silently lies the first time one is enabled.
   */
  useEffect(() => {
    const controller = new AbortController();
    fetchCapabilities(controller.signal)
      .then((caps) => setSolvers(caps.solvers))
      .catch(() => {
        // A missing capability list must not block planning. Fall back to the
        // one engine that has shipped.
        setSolvers([
          {
            name: "greedy",
            label: "Fast",
            available: true,
            description: "Clusters stops geographically, then sequences each route.",
          },
        ]);
      });
    return () => controller.abort();
  }, []);

  /**
   * Solve, then fetch road shapes.
   *
   * Two steps on purpose. The plan is correct the moment the solve returns, so
   * the routes are drawn immediately as straight lines and then upgraded to
   * road geometry when it arrives. A dispatcher never waits on a cosmetic
   * request, and an outage in it costs the drawing, not the plan.
   */
  const solve = useCallback(async () => {
    const problem = draftToProblem(draft.depot, draft.stops, planOptions);
    if (!problem) {
      setError("Set a depot and add at least one stop before planning.");
      return;
    }

    setSolving(true);
    setError(null);
    try {
      const solution = await solveProblem(problem);
      setPlan({ problem, solution });
      setPlanId((n) => n + 1);

      const working = solution.routes.filter((r) => r.stops.length > 0);
      const paths = working.map((route) => routePath(problem, route));

      // Straight lines first, so something appears the instant the plan lands.
      setDrawnRoutes(
        working.map((route, i) => ({
          vehicleIndex: route.vehicleIndex,
          path: paths[i],
          followsRoads: false,
        })),
      );

      const geometries = await fetchRouteGeometries(paths);
      setDrawnRoutes(
        working.map((route, i) => {
          const road = geometries[i];
          return {
            vehicleIndex: route.vehicleIndex,
            path: road ?? paths[i],
            followsRoads: road !== null,
          };
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the planner. Check your connection and try again.",
      );
    } finally {
      setSolving(false);
    }
  }, [draft.depot, draft.stops, planOptions]);

  /*
   * Editing the stops invalidates the plan. Leaving old routes drawn over moved
   * pins would show a plan that no longer matches the map, which is worse than
   * showing none.
   */
  useEffect(() => {
    setPlan(null);
    setDrawnRoutes([]);
  }, [draft.stops, draft.depot, planOptions]);

  /**
   * An escape hatch for hand-placed work.
   *
   * Stops clicked onto the map exist only in this tab, and a reload loses them.
   * Until share links land, copying the problem as JSON means that work can be
   * kept, mailed to someone, or posted straight to the API with curl.
   */
  const copyProblem = useCallback(async () => {
    const problem = draftToProblem(draft.depot, draft.stops, planOptions);
    if (!problem) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(problem, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to the clipboard. Your browser blocked it.");
    }
  }, [draft.depot, draft.stops, planOptions]);

  /* ----------------------------------------------------------- adding stops */

  const addFromText = useCallback(
    (text: string) => {
      const { rows, issues: found } = parseAddressList(text);
      setIssues(found);
      if (rows.length === 0) return;

      const added = rowsToDraftStops(rows);
      setDraft((current) => ({ ...current, stops: [...current.stops, ...added] }));
      setPasteText("");
      requestFit();
      void locate(added);
    },
    [locate, requestFit],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const { rows, issues: found } = parseUpload(file.name, text);
      setIssues(found);
      if (rows.length === 0) {
        setError("That file had no addresses in it. Expected one per line, or label,address.");
        return;
      }
      const added = rowsToDraftStops(rows);
      setDraft((current) => ({ ...current, stops: [...current.stops, ...added] }));
      requestFit();
      void locate(added);
    },
    [locate, requestFit],
  );

  /* ------------------------------------------------------------- the depot */

  const findDepot = useCallback(async () => {
    const query = depotQuery.trim();
    if (query === "") return;

    /*
     * Take a coordinate pair literally, exactly as the stops box does.
     * Someone pasting "48.8443, 2.3743" has told us precisely where the depot
     * is; sending that to a geocoder can only make it worse, and the
     * inconsistency between the two inputs is the kind of thing that makes a
     * tool feel unreliable.
     */
    const pair = query.split(",").map((part) => Number(part.trim()));
    if (pair.length === 2 && pair.every(Number.isFinite)) {
      const [lat, lng] = pair;
      if (checkCoordinate(lat, lng).ok) {
        setDraft((current) => ({
          ...current,
          depot: { ...current.depot, label: "Depot", address: undefined, lat, lng },
        }));
        setDepotQuery("");
        setError(null);
        requestFit();
        return;
      }
    }

    setError(null);
    setProgress({ done: 0, total: 1 });
    try {
      await geocodeAddresses([query], (results) => {
        const best = results[0]?.candidates[0];
        if (!best) {
          setError("That depot address didn't match. Try adding a city or postcode, or click the map.");
          return;
        }
        setDraft((current) => ({
          ...current,
          depot: {
            label: "Depot",
            address: best.displayName,
            lat: best.lat,
            lng: best.lng,
          },
        }));
        setDepotQuery("");
        requestFit();
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the address lookup. Check your connection and try again.",
      );
    } finally {
      setProgress(null);
    }
  }, [depotQuery, requestFit]);

  /* --------------------------------------------------------- map editing */

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (mode === "set-depot") {
        setDraft((current) => ({
          ...current,
          depot: { ...current.depot, label: "Depot", address: undefined, lat, lng },
        }));
        setMode("idle");
        return;
      }
      if (mode === "add-stop") {
        const stop: DraftStop = {
          id: nextStopId(),
          lat,
          lng,
          status: "manual",
        };
        setDraft((current) => ({ ...current, stops: [...current.stops, stop] }));
        setSelectedStopId(stop.id);
        // Stay in add mode: placing stops one after another is the whole point
        // of the tool, and re-arming after every click would be tedious.
      }
    },
    [mode],
  );

  const handleStopMoved = useCallback((id: string, lat: number, lng: number) => {
    setDraft((current) => ({
      ...current,
      stops: current.stops.map((s) => (s.id === id ? placeStopByHand(s, lat, lng) : s)),
    }));
  }, []);

  const handleDepotMoved = useCallback((lat: number, lng: number) => {
    setDraft((current) => ({
      ...current,
      depot: { ...current.depot, address: undefined, lat, lng },
    }));
  }, []);

  const handleChoose = useCallback((id: string, candidateIndex: number) => {
    setDraft((current) => ({
      ...current,
      stops: current.stops.map((s) => (s.id === id ? chooseCandidate(s, candidateIndex) : s)),
    }));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setDraft((current) => {
      setUndo({ draft: current, label: "Stop removed" });
      return { ...current, stops: current.stops.filter((s) => s.id !== id) };
    });
    setSelectedStopId((current) => (current === id ? null : current));
  }, []);

  const clearAll = useCallback(() => {
    setDraft((current) => {
      setUndo({ draft: current, label: "Plan cleared" });
      return emptyDraft();
    });
    setSelectedStopId(null);
    setIssues([]);
    setError(null);
  }, []);

  const undoLast = useCallback(() => {
    if (!undo) return;
    setDraft(undo.draft);
    setUndo(null);
  }, [undo]);

  /** Load the worked example, so an empty screen has something to show. */
  const loadDemo = useCallback(() => {
    setDraft((current) => {
      if (current.stops.length > 0) {
        setUndo({ draft: current, label: "Example loaded" });
      }
      return DEMO_DRAFT;
    });
    setIssues([]);
    setError(null);
    requestFit();
  }, [requestFit]);

  /*
   * Cmd+Enter is the one shortcut worth having.
   *
   * In the textarea it adds the stops; anywhere else it plans. A plain Enter
   * cannot do either — the textarea needs it for newlines, which is the whole
   * point of pasting a list.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      const inTextarea =
        (event.target as HTMLElement | null)?.tagName === "TEXTAREA";

      if (inTextarea && pasteText.trim() !== "") {
        event.preventDefault();
        addFromText(pasteText);
        return;
      }
      if (!inTextarea && summary.canSolve && !solving) {
        event.preventDefault();
        void solve();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pasteText, addFromText, summary.canSolve, solving, solve]);

  /* ------------------------------------------------------------------ view */

  const busy = progress !== null;

  return (
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="Plan">
        <header className={styles.masthead}>
          {/* The only route back to the site from the tool. */}
          <a className={styles.wordmark} href="/">
            RoutePlan
          </a>
          <span className={styles.tagline}>No account needed</span>
        </header>

        {/* ------------------------------------------------------- depot -- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Depot</h2>
            {summary.hasDepot && <span className={styles.count}>Set</span>}
          </div>

          <div className={styles.row}>
            <input
              className={styles.field}
              value={depotQuery}
              onChange={(e) => setDepotQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void findDepot();
              }}
              placeholder="Where do the vans start?"
              aria-label="Depot address"
              disabled={busy}
            />
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void findDepot()}
              disabled={busy || depotQuery.trim() === ""}
            >
              Find
            </button>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={mode === "set-depot" ? styles.toggleOn : styles.secondary}
              onClick={() => setMode(mode === "set-depot" ? "idle" : "set-depot")}
              aria-pressed={mode === "set-depot"}
            >
              {mode === "set-depot" ? "Click the map" : "Place on map"}
            </button>
          </div>

          {draft.depot.address && <p className={styles.hint}>{draft.depot.address}</p>}
        </section>

        {/* ------------------------------------------------------- input -- */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Stops</h2>
            <span className={styles.count}>
              {summary.total > 0 ? `${summary.total}` : ""}
            </span>
          </div>

          <textarea
            className={styles.textarea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"10 Downing Street, London\n221B Baker Street, London"}
            aria-label="Delivery addresses, one per line"
            disabled={busy}
          />

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => addFromText(pasteText)}
              disabled={busy || pasteText.trim() === ""}
            >
              Add stops
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              Upload CSV
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = "";
              }}
            />
          </div>

          <p className={styles.hint}>
            One address per line. CSV takes label,address or label,lat,lng.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={mode === "add-stop" ? styles.toggleOn : styles.secondary}
              onClick={() => setMode(mode === "add-stop" ? "idle" : "add-stop")}
              aria-pressed={mode === "add-stop"}
            >
              {mode === "add-stop" ? "Click the map to add" : "Add by clicking"}
            </button>
            {summary.total > 0 && (
              <button type="button" className={styles.secondary} onClick={clearAll}>
                Clear
              </button>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------- progress -- */}
        {progress && (
          <div className={styles.progress} role="status">
            Looking up {progress.done} of {progress.total}
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className={styles.notice} role="alert">
            {error}
          </div>
        )}

        {issues.length > 0 && (
          <div className={styles.notice}>
            {issues.length === 1
              ? "One line couldn't be read:"
              : `${issues.length} lines couldn't be read:`}
            <ul className={styles.issues}>
              {issues.slice(0, 5).map((issue) => (
                <li key={issue.line}>
                  Line {issue.line}: {issue.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          * An empty screen asks the visitor to supply data before it will show
          * them anything. One click puts a real round on the map instead.
          */}
        {summary.total === 0 && (
          <div className={styles.section}>
            <p className={styles.hint} style={{ marginTop: 0 }}>
              Not sure yet? Load a worked example: twelve stops across Paris,
              ready to plan.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={loadDemo}>
                Load an example
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------- undo -- */}
        {undo && (
          <div className={styles.progress} role="status">
            {undo.label}.{" "}
            <button type="button" className={styles.linkButton} onClick={undoLast}>
              Undo
            </button>
          </div>
        )}

        {/* --------------------------------------------------- stop list -- */}
        <StopList
          stops={draft.stops}
          selectedId={selectedStopId}
          onSelect={setSelectedStopId}
          onRemove={handleRemove}
          onChoose={handleChoose}
        />

        {/* ------------------------------------------------------- plan -- */}
        {summary.total > 0 && (
          <PlanControls
            options={planOptions}
            onChange={setPlanOptions}
            solvers={solvers}
            stopCount={summary.placed}
            canSolve={summary.canSolve}
            blockingReasons={summary.blockingReasons}
            solving={solving}
            onSolve={() => void solve()}
          />
        )}

        {/* ---------------------------------------------------- results -- */}
        {plan && (
          <>
            <RouteSummary
              problem={plan.problem}
              solution={plan.solution}
              onPrint={() => window.print()}
            />
            <DownloadPanel
              problem={plan.problem}
              solution={plan.solution}
              onPrint={() => window.print()}
            />
            <EngineComparison problem={plan.problem} solvers={solvers} />
            <SharePanel problem={plan.problem} solution={plan.solution} />
          </>
        )}

        {/* ------------------------------------------------------ footer -- */}
        {summary.total > 0 && (
          <footer className={styles.footer}>
            {plan ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => void copyProblem()}
              >
                {copied ? "Copied" : "Copy plan as JSON"}
              </button>
            ) : summary.canSolve ? (
              <p className={styles.ready}>
                {summary.total} {summary.total === 1 ? "stop" : "stops"} placed.
                {summary.needsReview > 0
                  ? ` ${summary.needsReview} to check on the map.`
                  : " Check the pins, then plan."}
              </p>
            ) : (
              <>
                <p className={styles.ready}>Not ready to plan yet.</p>
                <ul className={styles.blocking}>
                  {summary.blockingReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
          </footer>
        )}
      </aside>

      <div className={styles.mapPane}>
        <MapCanvas
          draft={draft}
          routes={drawnRoutes}
          planId={planId}
          fitRequest={fitRequest}
          mode={mode}
          selectedStopId={selectedStopId}
          onMapClick={handleMapClick}
          onStopMoved={handleStopMoved}
          onDepotMoved={handleDepotMoved}
          onStopSelected={setSelectedStopId}
        />
      </div>
    </div>
  );
}

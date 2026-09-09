import { NextResponse } from "next/server";
import {
  RATE_LIMITS,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { ZodError } from "zod";
import { MAX_STOPS, ProblemSchema } from "@/lib/schema";
import { buildMatrix } from "@/lib/matrix";
import { getSolver, listSolvers, SolverError } from "@/lib/solver";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The public solve endpoint.
 *
 * The map UI calls this, exactly as an external client would. There is no
 * private path from the browser to the solver. That is the whole point: the API
 * is exercised on every single request, so it cannot silently rot before the
 * day you decide to document it.
 *
 * No auth in v1 by design. Add rate limiting keyed on IP before any public launch.
 */

type ErrorCode =
  | "INVALID_PROBLEM"
  | "TOO_MANY_STOPS"
  | "MATRIX_UNAVAILABLE"
  | "SOLVER_TIMEOUT"
  | "SOLVER_UNAVAILABLE"
  | "UNKNOWN_SOLVER"
  | "INFEASIBLE"
  | "INTERNAL";

function fail(
  code: ErrorCode,
  message: string,
  status: number,
  detail?: unknown,
) {
  return NextResponse.json({ error: { code, message, detail } }, { status });
}

export async function POST(request: Request) {
  /*
   * No auth in v1 by design, so this is the only thing bounding cost. Checked
   * before the body is even read: a blocked caller should be cheap to refuse.
   */
  const limit = checkRateLimit(clientKey(request), RATE_LIMITS.solve);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Wait ${limit.retryAfterSeconds}s and try again.`,
        },
      },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_PROBLEM", "The request body isn't valid JSON.", 400);
  }

  // Count stops before validating. ProblemSchema caps the array at MAX_STOPS,
  // so an oversized plan would otherwise fail as a generic INVALID_PROBLEM and
  // the caller would never see TOO_MANY_STOPS — which is the one error here
  // that tells them exactly what to do about it.
  const submittedStops =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { stops?: unknown }).stops)
      ? ((raw as { stops: unknown[] }).stops.length)
      : null;

  if (submittedStops !== null && submittedStops > MAX_STOPS) {
    return fail(
      "TOO_MANY_STOPS",
      `This plan has ${submittedStops} stops. The limit is ${MAX_STOPS}. Split it into two plans.`,
      413,
    );
  }

  // Validate before anything expensive.
  let problem;
  try {
    problem = ProblemSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(
        "INVALID_PROBLEM",
        "Some fields are missing or malformed. Check the details and try again.",
        400,
        err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    throw err;
  }

  // Duplicate ids would silently corrupt the manifest, so catch them here.
  const ids = new Set(problem.stops.map((s) => s.id));
  if (ids.size !== problem.stops.length) {
    return fail("INVALID_PROBLEM", "Two stops share the same id.", 400);
  }

  try {
    const solver = getSolver(problem.options.solver);
    const { matrix, warnings } = await buildMatrix(problem);
    const solution = await solver.solve(problem, matrix);

    // Matrix warnings are about data quality; solver warnings are about the
    // plan. Both belong in front of the user, so merge and de-duplicate.
    solution.meta.warnings = Array.from(
      new Set([...warnings, ...solution.meta.warnings]),
    );

    return NextResponse.json(solution, {
      // The budget goes on every response, not just refusals, so a client can
      // slow down before it gets a 429.
      headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof SolverError) {
      const status = err.code === "SOLVER_TIMEOUT" ? 504 : 400;
      return fail(err.code, err.message, status);
    }
    console.error("[solve] unexpected failure:", err);
    return fail(
      "INTERNAL",
      "Something went wrong while planning. Try again in a moment.",
      500,
    );
  }
}

/** Feeds the solver selector so the UI never hardcodes engine names. */
export async function GET() {
  return NextResponse.json({
    version: 1,
    maxStops: MAX_STOPS,
    solvers: listSolvers(),
    objectives: [
      {
        value: "balanced",
        label: "Even workload",
        description: "Every driver finishes around the same time.",
      },
      {
        value: "distance",
        label: "Shortest total",
        description: "Fewest kilometres overall, even if one route is much longer.",
      },
    ],
  });
}

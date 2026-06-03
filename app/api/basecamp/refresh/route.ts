// =============================================================
// POST /api/basecamp/refresh
// =============================================================
//
// Admin-driven Basecamp todo refresh. Replaces the cron-only
// poller path for cases where an AM needs a fresh snapshot for a
// specific client (or the whole manifest) without waiting for the
// next scheduled run.
//
// Two modes (discriminated body):
//   { clientId: string }   — refresh a single Basecamp project
//   { all: true }          — refresh every entry in projects.json
//
// Skip rules apply in both modes:
//   - clientId "47431551" is the J999 INTEGRATION TEST project and
//     is always skipped (its todos are managed manually).
//   - non-numeric ids are GHL-created entries with no Basecamp
//     project behind them; skipped with reason "not_basecamp_syncable".
//
// SINGLE-MODE response includes the freshly-fetched todos array so
// the client UI can update state without a follow-up GET. ALL-MODE
// strips that payload (we don't want to send dozens of MB back to
// the operator) and returns per-client status only.
//
// commitClientData failures are warnings — the todos were fetched
// successfully, the GitHub write is best-effort. Returning 500 here
// would hide a successful sync behind a deploy-pipeline issue.

import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminRouteContext } from "@/app/lib/with-admin-auth";
import { syncOneClient, type FormattedTodo } from "@/app/lib/basecamp";
import { commitClientData } from "@/app/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    clientId: z.string().min(1).max(40),
  }),
  z.object({
    mode: z.literal("all"),
    all: z.literal(true),
  }),
]);

// Accept the spec's shape — { clientId } OR { all: true } — by
// pre-tagging the parsed body with a discriminator before handing
// to Zod. Keeping the schema discriminated keeps the type narrowing
// downstream clean.
function tagBody(raw: unknown): unknown {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.clientId === "string") {
      return { mode: "single", clientId: obj.clientId };
    }
    if (obj.all === true) {
      return { mode: "all", all: true };
    }
  }
  return raw;
}

/** The J999 INTEGRATION TEST project is always skipped — its todos
 * are seeded by hand and pulling from Basecamp would clobber them. */
const J999_INTEGRATION_TEST_ID = "47431551";

type SkipDecision =
  | { skip: false }
  | { skip: true; reason: "not_basecamp_syncable" };

function shouldSkip(clientId: string): SkipDecision {
  if (clientId === J999_INTEGRATION_TEST_ID) {
    return { skip: true, reason: "not_basecamp_syncable" };
  }
  if (!/^\d+$/.test(clientId)) {
    return { skip: true, reason: "not_basecamp_syncable" };
  }
  return { skip: false };
}

type SyncResult =
  | { clientId: string; status: "skipped"; reason: "not_basecamp_syncable" }
  | { clientId: string; status: "error"; error: string }
  | {
      clientId: string;
      status: "ok";
      todoCount: number;
      commitStatus: "committed" | "failed";
      commitError?: string;
      todos?: FormattedTodo[];
    };

/** Run the full sync for one client and return a status record.
 *
 * Used by both modes. In all-mode the caller strips the heavy `todos`
 * array before returning to the operator. */
async function runSync(clientId: string): Promise<SyncResult> {
  const skip = shouldSkip(clientId);
  if (skip.skip) {
    return { clientId, status: "skipped", reason: skip.reason };
  }

  let todos: FormattedTodo[];
  try {
    todos = await syncOneClient(clientId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { clientId, status: "error", error: message };
  }

  let commitStatus: "committed" | "failed" = "committed";
  let commitError: string | undefined;
  try {
    await commitClientData(clientId, todos);
  } catch (err) {
    commitStatus = "failed";
    commitError = err instanceof Error ? err.message : String(err);
    console.warn(
      `[basecamp-refresh] commitClientData failed for ${clientId}: ${commitError}`
    );
  }

  return {
    clientId,
    status: "ok",
    todoCount: todos.length,
    commitStatus,
    ...(commitError ? { commitError } : {}),
    todos,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const POST = withAdminAuth(
  {
    endpoint: "/api/basecamp/refresh",
    minRole: "admin",
    actionClass: "basecamp_refresh",
  },
  async (req: NextRequest, _routeArgs, _ctx: AdminRouteContext) => {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "body" },
        { status: 400 }
      );
    }

    const parse = BodySchema.safeParse(tagBody(rawBody));
    if (!parse.success) {
      return NextResponse.json(
        { ok: false, reason: "validation_failed", field: "body" },
        { status: 400 }
      );
    }

    // ----- SINGLE MODE -----
    if (parse.data.mode === "single") {
      const clientId = parse.data.clientId;

      const skip = shouldSkip(clientId);
      if (skip.skip) {
        return NextResponse.json({
          ok: true,
          clientId,
          status: "skipped",
          reason: skip.reason,
        });
      }

      let todos: FormattedTodo[];
      try {
        todos = await syncOneClient(clientId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { ok: false, clientId, reason: message },
          { status: 502 }
        );
      }

      let commitStatus: "committed" | "failed" = "committed";
      let commitError: string | undefined;
      try {
        await commitClientData(clientId, todos);
      } catch (err) {
        commitStatus = "failed";
        commitError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[basecamp-refresh] commitClientData failed for ${clientId}: ${commitError}`
        );
      }

      return NextResponse.json({
        ok: true,
        clientId,
        todoCount: todos.length,
        commitStatus,
        ...(commitError ? { commitError } : {}),
        todos,
      });
    }

    // ----- ALL MODE -----
    let manifest: Array<{ id: string }>;
    try {
      const path = join(process.cwd(), "app", "data", "projects.json");
      manifest = JSON.parse(readFileSync(path, "utf-8")) as Array<{ id: string }>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, reason: "manifest_read_failed", details: message },
        { status: 500 }
      );
    }

    const results: Array<Omit<SyncResult, "todos">> = [];
    for (const project of manifest) {
      const clientId = String(project.id);
      const result = await runSync(clientId);
      // Strip the heavy todos[] payload from all-mode results.
      if (result.status === "ok") {
        const { todos: _todos, ...rest } = result;
        results.push(rest);
      } else {
        results.push(result);
      }
      // Polite delay between Basecamp calls to keep us well under
      // the 50 req / 10 s rate budget.
      await sleep(150);
    }

    return NextResponse.json({ ok: true, results });
  }
);

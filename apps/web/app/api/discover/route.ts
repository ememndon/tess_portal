import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { getRedis } from "@/lib/server/health";
import { isGloballyPaused } from "@/lib/ai/meter";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("dismiss"), jobId: z.string().uuid() }),
  z.object({ action: z.literal("dismiss-bulk"), jobIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ action: z.literal("run") }),
]);

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const body = guard.body;

  if (body.action === "save") {
    const job = await scope.saveDiscovered(body.jobId);
    return job ? NextResponse.json({ ok: true }) : jsonError("job not found", 404);
  }
  if (body.action === "dismiss") {
    const ok = await scope.dismissDiscovered(body.jobId);
    return ok ? NextResponse.json({ ok: true }) : jsonError("job not found", 404);
  }

  if (body.action === "dismiss-bulk") {
    const n = await scope.dismissDiscoveredBulk(body.jobIds);
    return NextResponse.json({ ok: true, dismissed: n });
  }

  // action: run — trigger an on-demand discovery run in the worker
  if (await isGloballyPaused()) {
    return jsonError("the platform is paused by an admin, discovery does not run until it resumes", 503);
  }
  await getRedis().publish("discovery:run-user", guard.user.id);
  return NextResponse.json({ ok: true, started: true });
}

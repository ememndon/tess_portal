import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { requestIp } from "@/lib/server/auth";
import { approveAndExecute, rejectApproval } from "@/lib/server/approvals";
// executor registrations live in the tool layer; importing it wires them
import "@/lib/tess/tools";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const ip = await requestIp();
  const result =
    guard.body.decision === "approve"
      ? await approveAndExecute(guard.user.id, guard.body.id, ip)
      : await rejectApproval(guard.user.id, guard.body.id, ip);
  if (!result) {
    return NextResponse.json({ error: "approval not found or already decided" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    status: result.status,
    summary: "executionSummary" in result ? result.executionSummary : undefined,
  });
}

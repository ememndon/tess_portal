import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getGate,
  issueGateCookie,
  requestIp,
  sameOrigin,
  verifyGateCredential,
} from "@/lib/server/auth";
import { allowAttempt } from "@/lib/server/rate-limit";
import { jsonError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return jsonError("bad origin", 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("enter the access username and password", 400);

  if (!(await allowAttempt(await requestIp()))) {
    return jsonError("too many attempts, wait 15 minutes", 429);
  }

  const gate = await getGate();
  if (!gate) {
    return jsonError("the gate credential is not set yet, set it from the server", 503);
  }
  const ok = await verifyGateCredential(parsed.data.username, parsed.data.password);
  if (!ok) return jsonError("that access credential is not right", 401);

  await issueGateCookie(gate.version);
  return NextResponse.json({ ok: true });
}

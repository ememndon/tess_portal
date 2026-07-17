import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { issueGateCookie, requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { listUsers, rotateGate } from "@/lib/server/admin";
import { createNotification } from "@/lib/server/notify";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: z.string().trim().min(3, "use at least 3 characters").max(200),
  password: z.string().min(10, "use at least 10 characters").max(500),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;

  const gate = await rotateGate(guard.body.username, guard.body.password);
  // the actor keeps working: their gate cookie moves to the new version
  await issueGateCookie(gate.version);

  await audit({
    userId: guard.user.id,
    action: "gate.rotated",
    targetType: "gate_config",
    targetId: "1",
    snapshot: { version: gate.version, username: gate.username },
    ip: await requestIp(),
    system: true,
  });

  const everyone = await listUsers();
  for (const u of everyone) {
    if (u.id === guard.user.id) continue;
    await createNotification(u.id, {
      type: "gate.rotated",
      title: "The access credential was rotated",
      body: "Everyone signs in with the new shared credential from now on.",
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, version: gate.version });
}

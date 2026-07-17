import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { PLATFORM_KINDS, USER_KINDS } from "@/lib/server/vault";
import { testSecret } from "@/lib/server/vault-test";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  scope: z.enum(["platform", "user"]),
  kind: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const { scope, kind, name } = guard.body;
  const allowed =
    scope === "platform"
      ? (PLATFORM_KINDS as readonly string[]).includes(kind)
      : (USER_KINDS as readonly string[]).includes(kind);
  if (!allowed) return jsonError("unknown kind", 400);

  const owner = scope === "platform" ? null : guard.user.id;
  const result = await testSecret(owner, kind, name, guard.user.email);
  return NextResponse.json(result);
}

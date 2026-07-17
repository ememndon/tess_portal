import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import {
  PLATFORM_KINDS,
  USER_KINDS,
  deleteSecret,
  setSecret,
} from "@/lib/server/vault";

export const dynamic = "force-dynamic";

/**
 * Vault API, write-only. POST sets or replaces, DELETE removes.
 * There is no GET for values anywhere, by design.
 */

const setSchema = z.object({
  scope: z.enum(["platform", "user"]),
  kind: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  value: z.string().min(1).max(20000),
});

const deleteSchema = setSchema.omit({ value: true });

function kindAllowed(scope: "platform" | "user", kind: string): boolean {
  return scope === "platform"
    ? (PLATFORM_KINDS as readonly string[]).includes(kind)
    : (USER_KINDS as readonly string[]).includes(kind);
}

export async function POST(req: Request) {
  const guard = await guardedBody(req, setSchema);
  if (!guard.ok) return guard.res;
  const { scope, kind, name, value } = guard.body;
  if (!kindAllowed(scope, kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

  const owner = scope === "platform" ? null : guard.user.id;
  await setSecret(owner, kind, name, value);
  await audit({
    userId: guard.user.id,
    action: "vault.set",
    targetType: "vault_secret",
    targetId: `${scope}:${kind}:${name}`,
    // the snapshot records that a value was set, never the value
    snapshot: { scope, kind, name },
    ip: await requestIp(),
    system: scope === "platform",
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, deleteSchema);
  if (!guard.ok) return guard.res;
  const { scope, kind, name } = guard.body;
  if (!kindAllowed(scope, kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

  const owner = scope === "platform" ? null : guard.user.id;
  await deleteSecret(owner, kind, name);
  await audit({
    userId: guard.user.id,
    action: "vault.deleted",
    targetType: "vault_secret",
    targetId: `${scope}:${kind}:${name}`,
    snapshot: { scope, kind, name },
    ip: await requestIp(),
    system: scope === "platform",
  });
  return NextResponse.json({ ok: true });
}

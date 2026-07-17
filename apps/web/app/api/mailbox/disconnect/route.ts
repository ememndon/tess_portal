import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { deleteSecret } from "@/lib/server/vault";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ confirm: z.literal(true) });

/** Disconnects the mailbox: removes the account (cascades folders/messages) and vault creds. */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  await scope.deleteMailAccount();
  await deleteSecret(guard.user.id, "user_imap", "default");
  await deleteSecret(guard.user.id, "user_smtp", "default");
  return NextResponse.json({ ok: true });
}

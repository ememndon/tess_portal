import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { draftMailBody } from "@/lib/server/mail-draft";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["new", "reply", "forward"]),
  to: z.string().max(1000).optional(),
  subject: z.string().max(400).optional(),
  quoted: z.string().max(20000).optional(),
  instruction: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  try {
    const draft = await draftMailBody({ userId: guard.user.id, ...guard.body });
    return NextResponse.json({ ok: true, subject: draft.subject, body: draft.body });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 200) }, { status: 502 });
  }
}

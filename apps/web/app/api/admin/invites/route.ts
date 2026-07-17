import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { createInvite } from "@/lib/server/admin";
import { MailNotConfiguredError, sendPlatformMail } from "@/lib/server/mailer";
import { getLogger } from "@/lib/server/health";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.string().email().max(320) });

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;

  const invite = await createInvite(guard.body.email, guard.user.id);
  await audit({
    userId: guard.user.id,
    action: "invite.created",
    targetType: "invite",
    targetId: invite.email,
    snapshot: { email: invite.email, expiresAt: invite.expiresAt },
    ip: await requestIp(),
    system: true,
  });

  let emailed = false;
  try {
    await sendPlatformMail({
      to: invite.email,
      subject: "You are invited to Tess Portal",
      text: [
        `${guard.user.name || guard.user.email} invited you to Tess Portal, a private job search platform run by Tess.`,
        "",
        "Open this link to set your password and get started:",
        invite.link,
        "",
        "The link expires in 7 days. You will also need the shared access credential, ask the person who invited you for it.",
      ].join("\n"),
    });
    emailed = true;
  } catch (err) {
    if (!(err instanceof MailNotConfiguredError)) {
      getLogger().error({ err: (err as Error).message }, "invite email failed");
    }
  }

  // the link is returned once so the admin can pass it on when email
  // is not configured; only the token hash is stored
  return NextResponse.json({ ok: true, link: invite.link, emailed });
}

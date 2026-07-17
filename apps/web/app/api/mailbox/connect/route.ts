import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { setSecret } from "@/lib/server/vault";
import { testMailbox } from "@/lib/server/vault-test";
import { assertPublicHost } from "@/lib/server/net-guard";
import { getRedis } from "@/lib/server/health";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().max(120).optional(),
  imapHost: z.string().trim().min(1).max(200),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  smtpHost: z.string().trim().min(1).max(200),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(465),
  password: z.string().min(1).max(500),
  sendTest: z.boolean().optional(),
});

/**
 * Connects an external mailbox: live-tests IMAP + SMTP, and only on
 * success stores the credentials in the vault, records the account, and
 * kicks off folder discovery. Credentials never come back in a response.
 */
export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const b = guard.body;

  // SSRF guard: never open connections to internal/private addresses
  try {
    await assertPublicHost(b.imapHost);
    await assertPublicHost(b.smtpHost);
  } catch {
    return NextResponse.json({
      ok: false,
      stage: "host",
      imap: {
        ok: false,
        message: "That mail server address isn't allowed. Use your provider's public IMAP/SMTP host.",
      },
      smtp: null,
    });
  }

  const username = b.email; // Hostinger and most cPanel hosts use the full address

  const imapCfg = JSON.stringify({
    host: b.imapHost,
    port: b.imapPort,
    secure: b.imapPort === 993,
    user: username,
    pass: b.password,
  });
  const smtpCfg = JSON.stringify({
    host: b.smtpHost,
    port: b.smtpPort,
    secure: b.smtpPort === 465,
    user: username,
    pass: b.password,
    from: b.displayName ? `${b.displayName} <${b.email}>` : b.email,
  });

  const result = await testMailbox(imapCfg, smtpCfg, b.sendTest ? guard.user.email : null);
  if (!result.imap.ok) {
    return NextResponse.json({ ok: false, stage: "imap", imap: result.imap, smtp: result.smtp });
  }
  if (!result.smtp.ok) {
    return NextResponse.json({ ok: false, stage: "smtp", imap: result.imap, smtp: result.smtp });
  }

  await setSecret(guard.user.id, "user_imap", "default", imapCfg);
  await setSecret(guard.user.id, "user_smtp", "default", smtpCfg);
  await scope.upsertMailAccount({
    email: b.email,
    displayName: b.displayName ?? null,
    imapHost: b.imapHost,
    imapPort: b.imapPort,
    smtpHost: b.smtpHost,
    smtpPort: b.smtpPort,
    username,
  });
  await getRedis().publish("mail:sync", guard.user.id);

  return NextResponse.json({ ok: true, imap: result.imap, smtp: result.smtp });
}

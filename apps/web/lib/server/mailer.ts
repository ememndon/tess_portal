import nodemailer from "nodemailer";
import { z } from "zod";
import { readSecret } from "./vault";
import { getLogger } from "./health";

/**
 * Platform email over SMTP. Credentials live only in the vault under
 * kind platform_smtp, name default. Until they are set, callers get a
 * MailNotConfiguredError and surface a copyable fallback instead.
 */

export class MailNotConfiguredError extends Error {
  constructor() {
    super("platform SMTP is not configured");
  }
}

const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int(),
  secure: z.coerce.boolean().default(true),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().min(1).default("Tess Portal <tess@tessconsole.cloud>"),
});

export async function sendPlatformMail(mail: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const raw = await readSecret(null, "platform_smtp", "default");
  if (!raw) throw new MailNotConfiguredError();
  let cfg: z.infer<typeof smtpSchema>;
  try {
    cfg = smtpSchema.parse(JSON.parse(raw));
  } catch {
    throw new MailNotConfiguredError();
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transport.sendMail({
    from: cfg.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
  getLogger().info({ to: mail.to, subject: mail.subject }, "platform mail sent");
}

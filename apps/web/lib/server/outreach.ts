import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { z } from "zod";
import { getDb } from "./db";
import { readSecret } from "./vault";
import { getLogger } from "./health";

const { linkClicks, outreachMessages } = schema;

/**
 * Outreach sending and portfolio link tracking. Approved outreach sends
 * from the user's own connected mailbox over their SMTP. Portfolio links
 * are wrapped in a tracked redirect so clicks are logged against the job.
 */

const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int(),
  secure: z.coerce.boolean().optional(),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().optional(),
});

export async function getUserSmtp(userId: string) {
  const raw = await readSecret(userId, "user_smtp", "default");
  if (!raw) return null;
  try {
    const cfg = smtpSchema.parse(JSON.parse(raw));
    return {
      transport: nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure === undefined ? cfg.port === 465 : cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
      }),
      from: cfg.from || cfg.user,
      address: cfg.user,
    };
  } catch {
    return null;
  }
}

/**
 * Wraps http(s) links in the body with tracked redirect URLs, one
 * link_clicks row per link. Returns the rewritten body.
 */
export async function wrapTrackedLinks(
  userId: string,
  body: string,
  ctx: { jobId?: string | null; messageId?: string | null },
): Promise<string> {
  const db = getDb();
  const appUrl = process.env.APP_URL ?? "";
  const urlRe = /(https?:\/\/[^\s<>()]+)(?=[\s<>().,]|$)/g;
  const urls = [...new Set([...body.matchAll(urlRe)].map((m) => m[1]))];
  let out = body;
  for (const url of urls) {
    // do not wrap our own tracked links
    if (url.includes("/r/")) continue;
    const token = randomBytes(12).toString("hex");
    await db.insert(linkClicks).values({
      userId,
      token,
      url,
      jobId: ctx.jobId ?? null,
      messageId: ctx.messageId ?? null,
    });
    out = out.split(url).join(`${appUrl}/r/${token}`);
  }
  return out;
}

/**
 * Executes an approved outreach send. Sends from the user's mailbox when
 * connected, storing the exact sent content; otherwise stores a
 * copy-ready draft. Returns a summary and whether it actually sent.
 */
export async function executeOutreachSend(
  userId: string,
  payload: { toEmail?: string; subject?: string; body: string; jobId?: string | null; contactId?: string | null; sequenceId?: string | null; variant?: string | null },
): Promise<{ summary: string; sent: boolean; messageId: string }> {
  const db = getDb();
  const smtp = await getUserSmtp(userId);

  // insert the message first so tracked links can reference it
  const [msg] = await db
    .insert(outreachMessages)
    .values({
      userId,
      contactId: payload.contactId ?? null,
      jobId: payload.jobId ?? null,
      sequenceId: payload.sequenceId ?? null,
      channel: "email",
      direction: "out",
      subject: payload.subject ?? null,
      body: payload.body,
      toEmail: payload.toEmail ?? null,
      variant: payload.variant ?? null,
      status: smtp ? "sending" : "approved_draft",
    })
    .returning();

  const trackedBody = await wrapTrackedLinks(userId, payload.body, { jobId: payload.jobId, messageId: msg.id });

  if (!smtp || !payload.toEmail) {
    await db
      .update(outreachMessages)
      .set({ status: "approved_draft", body: trackedBody })
      .where(eq(outreachMessages.id, msg.id));
    return {
      summary: "no mailbox connected, stored as a copy-ready draft with tracked links",
      sent: false,
      messageId: msg.id,
    };
  }

  try {
    await smtp.transport.sendMail({
      from: smtp.from,
      to: payload.toEmail,
      subject: payload.subject ?? "",
      text: trackedBody,
    });
  } catch (err) {
    await db.update(outreachMessages).set({ status: "failed" }).where(eq(outreachMessages.id, msg.id));
    getLogger().error({ err: (err as Error).message }, "outreach send failed");
    throw new Error("sending from your mailbox failed, check your SMTP settings");
  }

  await db
    .update(outreachMessages)
    .set({ status: "sent", sentAt: new Date(), body: trackedBody, fromEmail: smtp.address })
    .where(eq(outreachMessages.id, msg.id));

  return { summary: `sent from ${smtp.address} to ${payload.toEmail}`, sent: true, messageId: msg.id };
}

export async function recordLinkClick(token: string): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(linkClicks).where(eq(linkClicks.token, token)).limit(1);
  const link = rows[0];
  if (!link) return null;
  await db
    .update(linkClicks)
    .set({ clickCount: link.clickCount + 1, clickedAt: new Date() })
    .where(eq(linkClicks.id, link.id));
  return link.url;
}

export async function listLinkClicksForJob(userId: string, jobId: string) {
  return getDb()
    .select()
    .from(linkClicks)
    .where(and(eq(linkClicks.userId, userId), eq(linkClicks.jobId, jobId)));
}

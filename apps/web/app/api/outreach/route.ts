import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { createApproval } from "@/lib/server/approvals";
import "@/lib/tess/tools"; // wire the outreach.send executor

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  action: z.literal("request_send"),
  toEmail: z.string().email(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  jobId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  variant: z.string().max(40).optional(),
  sequenceId: z.string().uuid().optional(),
});

const sequenceSchema = z.object({
  action: z.literal("create_sequence"),
  name: z.string().trim().min(1).max(160),
  jobId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  steps: z.array(z.object({ kind: z.string().max(40), waitDays: z.number().int().min(0).max(60) })).min(1).max(8),
});

const bodySchema = z.discriminatedUnion("action", [sendSchema, sequenceSchema]);

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const scope = scopeFor(guard.user.id);
  const body = guard.body;

  // a referenced job or contact must belong to this user
  if (body.jobId && !(await scope.getJob(body.jobId))) return jsonError("job not found", 404);
  if (body.contactId && !(await scope.getContact(body.contactId))) return jsonError("contact not found", 404);

  if (body.action === "request_send") {
    // sending is sensitive: always create an approval, never send directly
    const approval = await createApproval({
      userId: guard.user.id,
      kind: "outreach.send",
      title: `Outreach email to ${body.toEmail}`,
      summary: `Subject: ${body.subject}. ${body.body.split(/\s+/).length} words.`,
      payload: {
        toEmail: body.toEmail,
        subject: body.subject,
        body: body.body,
        jobId: body.jobId ?? null,
        contactId: body.contactId ?? null,
        sequenceId: body.sequenceId ?? null,
        variant: body.variant ?? null,
      },
    });
    return NextResponse.json({ ok: true, approvalId: approval.id });
  }

  // create_sequence
  const seq = await scope.createSequence({
    name: body.name,
    jobId: body.jobId ?? null,
    contactId: body.contactId ?? null,
    steps: body.steps,
  });
  return NextResponse.json({ ok: true, sequenceId: seq.id });
}

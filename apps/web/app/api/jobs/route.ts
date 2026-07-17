import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody } from "@/lib/server/api";
import { scopeFor, JOB_STAGES } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().trim().min(1, "enter a job title").max(200),
  companyName: z.string().trim().min(1, "enter the company").max(160),
  location: z.string().trim().max(120).optional(),
  countryCode: z.string().length(2).optional(),
  url: z.string().url().max(2000).optional().or(z.literal("")),
  source: z.enum(["manual", "paste"]).default("manual"),
  description: z.string().max(60000).optional(),
  salaryRaw: z.string().max(200).optional(),
  sponsorship: z.enum(["yes", "no", "inferred", "unknown"]).default("unknown"),
  stage: z.enum(JOB_STAGES).default("saved"),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const { url, ...rest } = guard.body;
  const job = await scopeFor(guard.user.id).createJob({ ...rest, url: url || undefined });
  return NextResponse.json({ ok: true, id: job.id });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "enter a name").max(160),
  role: z.string().trim().max(120).optional(),
  companyName: z.string().trim().max(160).optional(),
  email: z.string().email().max(320).optional().or(z.literal("")),
  linkedin: z.string().url().max(2000).optional().or(z.literal("")),
  notes: z.string().max(5000).optional(),
});

export async function POST(req: Request) {
  const guard = await guardedBody(req, createSchema);
  if (!guard.ok) return guard.res;
  const { email, linkedin, ...rest } = guard.body;
  const contact = await scopeFor(guard.user.id).createContact({
    ...rest,
    email: email || undefined,
    linkedin: linkedin || undefined,
  });
  return NextResponse.json({ ok: true, id: contact.id });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
  role: z.string().trim().max(120).optional().or(z.literal("")),
  companyName: z.string().trim().max(160).optional().or(z.literal("")),
  email: z.string().email().max(320).optional().or(z.literal("")),
  linkedin: z.string().url().max(2000).optional().or(z.literal("")),
});

export async function PATCH(req: Request) {
  const guard = await guardedBody(req, patchSchema);
  if (!guard.ok) return guard.res;
  const { id, ...patch } = guard.body;
  const row = await scopeFor(guard.user.id).updateContact(id, patch);
  return row ? NextResponse.json({ ok: true, id: row.id }) : jsonError("contact not found", 404);
}

export async function DELETE(req: Request) {
  const guard = await guardedBody(req, z.object({ id: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  const ok = await scopeFor(guard.user.id).deleteContact(guard.body.id);
  return ok ? NextResponse.json({ ok: true }) : jsonError("contact not found", 404);
}

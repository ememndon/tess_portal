import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, sameOrigin, type AuthedUser } from "./auth";

/**
 * Shared plumbing for mutating API routes: same-origin check, session
 * requirement, and Zod validation on the input boundary.
 */

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function guardedBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<
  | { ok: true; user: AuthedUser; body: z.infer<S> }
  | { ok: false; res: NextResponse }
> {
  if (!(await sameOrigin())) return { ok: false, res: jsonError("bad origin", 403) };
  const user = await apiUser();
  if (!user) return { ok: false, res: jsonError("unauthorized", 401) };
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: jsonError("invalid json", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, res: jsonError(parsed.error.issues[0]?.message ?? "invalid input", 400) };
  }
  return { ok: true, user, body: parsed.data };
}

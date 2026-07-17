import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@tessportal/db";
import { guardedBody, jsonError } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { setGlobalPause } from "@/lib/ai/meter";
import { getRedis } from "@/lib/server/health";
import { ACTIVITIES, PROVIDERS, modelInfo } from "@/lib/ai/catalog";

export const dynamic = "force-dynamic";

const { capConfig, modelRouting, scheduledTasks } = schema;

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_cap"),
    monthlyCapUsd: z.coerce.number().min(0).max(10000),
  }),
  z.object({ action: z.literal("set_pause"), paused: z.boolean() }),
  z.object({
    action: z.literal("set_routing"),
    activity: z.string().min(1).max(60),
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(120),
  }),
  z.object({
    action: z.literal("task"),
    taskId: z.string().min(1).max(120),
    op: z.enum(["pause", "resume", "run"]),
  }),
  z.object({
    action: z.literal("set_schedule_window"),
    startHour: z.coerce.number().int().min(0).max(23),
    endHour: z.coerce.number().int().min(0).max(23),
  }),
  z.object({
    action: z.literal("source"),
    sourceId: z.string().uuid(),
    op: z.enum(["enable", "disable", "proxy_on", "proxy_off"]),
  }),
]);

export async function POST(req: Request) {
  const guard = await guardedBody(req, bodySchema);
  if (!guard.ok) return guard.res;
  const db = getDb();
  const body = guard.body;
  const ip = await requestIp();

  if (body.action === "set_cap") {
    await db
      .insert(capConfig)
      .values({ id: 1, monthlyCapUsd: body.monthlyCapUsd.toFixed(2) })
      .onConflictDoUpdate({
        target: capConfig.id,
        set: { monthlyCapUsd: body.monthlyCapUsd.toFixed(2), updatedAt: new Date() },
      });
    await audit({
      userId: guard.user.id,
      action: "cap.changed",
      snapshot: { monthlyCapUsd: body.monthlyCapUsd },
      ip,
      system: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_pause") {
    await setGlobalPause(body.paused);
    await audit({
      userId: guard.user.id,
      action: body.paused ? "platform.paused" : "platform.resumed",
      snapshot: { paused: body.paused },
      ip,
      system: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_routing") {
    const valid =
      body.provider === "auto" ||
      (PROVIDERS.some((p) => p.id === body.provider) && modelInfo(body.provider, body.model));
    if (!valid) return jsonError("unknown provider or model", 400);
    if (!ACTIVITIES.some((a) => a.activity === body.activity)) return jsonError("unknown activity", 400);
    await db
      .insert(modelRouting)
      .values({ activity: body.activity, provider: body.provider, model: body.model })
      .onConflictDoUpdate({
        target: modelRouting.activity,
        set: { provider: body.provider, model: body.model, updatedAt: new Date() },
      });
    await audit({
      userId: guard.user.id,
      action: "routing.changed",
      snapshot: { activity: body.activity, provider: body.provider, model: body.model },
      ip,
      system: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_schedule_window") {
    await db
      .insert(schema.appMeta)
      .values({ key: "schedule.window", value: { startHour: body.startHour, endHour: body.endHour } })
      .onConflictDoUpdate({
        target: schema.appMeta.key,
        set: { value: { startHour: body.startHour, endHour: body.endHour }, updatedAt: new Date() },
      });
    await audit({
      userId: guard.user.id,
      action: "schedule.window_changed",
      snapshot: { startHour: body.startHour, endHour: body.endHour },
      ip,
      system: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "source") {
    const patch =
      body.op === "enable"
        ? { enabled: true }
        : body.op === "disable"
          ? { enabled: false }
          : body.op === "proxy_on"
            ? { proxyEnabled: true }
            : { proxyEnabled: false };
    const [row] = await db
      .update(schema.sources)
      .set(patch)
      .where(eq(schema.sources.id, body.sourceId))
      .returning({ id: schema.sources.id });
    if (!row) return jsonError("source not found", 404);
    await audit({
      userId: guard.user.id,
      action: `source.${body.op}`,
      targetType: "source",
      targetId: body.sourceId,
      ip,
      system: true,
    });
    return NextResponse.json({ ok: true });
  }

  // task ops
  const rows = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, body.taskId)).limit(1);
  const task = rows[0];
  if (!task) return jsonError("task not found", 404);
  if (body.op === "pause") {
    if (task.critical) return jsonError("critical tasks cannot be switched off", 400);
    await db.update(scheduledTasks).set({ enabled: false }).where(eq(scheduledTasks.id, body.taskId));
  } else if (body.op === "resume") {
    await db.update(scheduledTasks).set({ enabled: true }).where(eq(scheduledTasks.id, body.taskId));
  } else {
    await getRedis().publish("tasks:run-now", body.taskId);
  }
  await audit({
    userId: guard.user.id,
    action: `task.${body.op}`,
    targetType: "scheduled_task",
    targetId: body.taskId,
    ip,
    system: true,
  });
  return NextResponse.json({ ok: true });
}

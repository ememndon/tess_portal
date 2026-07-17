import { NextResponse } from "next/server";
import { getLogger, getRedis, getSql } from "@/lib/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkDb(): Promise<boolean> {
  const sql = getSql();
  await sql`select 1`;
  return true;
}

async function checkRedis(): Promise<boolean> {
  const redis = getRedis();
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  return (await redis.ping()) === "PONG";
}

async function checkMeili(): Promise<boolean> {
  const host = process.env.MEILI_HOST ?? "";
  const res = await fetch(`${host}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  return res.ok;
}

export async function GET() {
  const log = getLogger();
  const results = await Promise.allSettled([checkDb(), checkRedis(), checkMeili()]);
  const [db, redis, search] = results.map((r) =>
    r.status === "fulfilled" && r.value ? "ok" : "fail",
  );
  const healthy = db === "ok" && redis === "ok" && search === "ok";
  if (!healthy) {
    log.error({ db, redis, search }, "health check failing");
  }
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", service: "web", checks: { db, redis, search } },
    { status: healthy ? 200 : 503 },
  );
}

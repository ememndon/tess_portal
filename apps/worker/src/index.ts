import http from "node:http";
import { Redis } from "ioredis";
import { z } from "zod";
import { createLogger } from "@tessportal/shared";
import { appMeta, createDb } from "@tessportal/db";
import { runMigrations } from "@tessportal/db/migrate";
import { startScheduler } from "./scheduler";
import { startMailboxWorker } from "./mailbox";
import { seedPlatformData } from "./seed";
import { handleRenderRequest } from "./render";

const log = createLogger("worker");

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WORKER_HEALTH_PORT: z.coerce.number().int().default(3001),
  })
  .parse(process.env);

async function main() {
  log.info("worker starting");

  log.info("applying database migrations");
  await runMigrations(env.DATABASE_URL);
  log.info("database migrations up to date");

  const { db, client } = createDb(env.DATABASE_URL, { max: 3 });
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  redis.on("error", (err) => log.error({ err: err.message }, "redis error"));

  await db
    .insert(appMeta)
    .values({ key: "worker.last_boot", value: { at: new Date().toISOString() } })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: { at: new Date().toISOString() }, updatedAt: new Date() },
    });

  const server = http.createServer(async (req, res) => {
    if (req.url === "/render/pdf" && req.method === "POST") {
      await handleRenderRequest(req, res, log);
      return;
    }
    if (req.url === "/health" && req.method === "GET") {
      const checks: Record<string, string> = { db: "fail", redis: "fail" };
      try {
        await client`select 1`;
        checks.db = "ok";
      } catch (err) {
        log.error({ err: (err as Error).message }, "health check db failed");
      }
      try {
        if ((await redis.ping()) === "PONG") checks.redis = "ok";
      } catch (err) {
        log.error({ err: (err as Error).message }, "health check redis failed");
      }
      const healthy = Object.values(checks).every((v) => v === "ok");
      res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", service: "worker", checks }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(env.WORKER_HEALTH_PORT, "0.0.0.0", () => {
    log.info({ port: env.WORKER_HEALTH_PORT }, "worker health endpoint listening");
  });

  await seedPlatformData(db);
  log.info("platform data seeded");
  const stopScheduler = await startScheduler(db, log);
  const stopMailbox = await startMailboxWorker(db, redis, log);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "worker shutting down");
    await stopScheduler().catch(() => {});
    await stopMailbox().catch(() => {});
    server.close();
    await redis.quit().catch(() => {});
    await client.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.message : String(err) }, "worker failed to start");
  process.exit(1);
});

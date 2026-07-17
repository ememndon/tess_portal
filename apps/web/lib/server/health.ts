import { Redis } from "ioredis";
import postgres from "postgres";
import { createLogger, type Logger } from "@tessportal/shared";

/**
 * Lazily created singletons for the web container's health checks.
 * Cached on globalThis so dev hot reload and route re-evaluation never
 * pile up connections.
 */
const g = globalThis as unknown as {
  __tpLog?: Logger;
  __tpSql?: ReturnType<typeof postgres>;
  __tpRedis?: Redis;
};

export function getLogger(): Logger {
  g.__tpLog ??= createLogger("web");
  return g.__tpLog;
}

export function getSql() {
  g.__tpSql ??= postgres(process.env.DATABASE_URL ?? "", {
    max: 3,
    connect_timeout: 5,
    onnotice: () => {},
  });
  return g.__tpSql;
}

export function getRedis(): Redis {
  if (!g.__tpRedis) {
    g.__tpRedis = new Redis(process.env.REDIS_URL ?? "", {
      maxRetriesPerRequest: 2,
    });
    g.__tpRedis.on("error", (err) => {
      getLogger().error({ err: err.message }, "redis connection error");
    });
  }
  return g.__tpRedis;
}

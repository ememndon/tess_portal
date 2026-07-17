import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";
export { appMeta } from "./schema";

export function createDb(databaseUrl: string, options?: { max?: number }) {
  const client = postgres(databaseUrl, {
    max: options?.max ?? 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];

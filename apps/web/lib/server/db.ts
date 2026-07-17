import { createDb, type Db } from "@tessportal/db";

const g = globalThis as unknown as { __tpDb?: ReturnType<typeof createDb> };

export function getDb(): Db {
  g.__tpDb ??= createDb(process.env.DATABASE_URL ?? "", { max: 10 });
  return g.__tpDb.db;
}

import { schema } from "@tessportal/db";
import { getDb } from "./db";

const { auditLog } = schema;

/**
 * Audit log foundation. Every sensitive action records actor, action,
 * target, a frozen content snapshot, and the request ip. System-scope
 * entries (system: true) appear in the admin system log; everything
 * else is personal and visible only to its actor.
 */
export async function audit(entry: {
  userId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  snapshot?: unknown;
  ip?: string;
  system?: boolean;
}) {
  await getDb().insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    snapshot: entry.snapshot ?? null,
    ip: entry.ip ?? null,
    system: entry.system ?? false,
  });
}

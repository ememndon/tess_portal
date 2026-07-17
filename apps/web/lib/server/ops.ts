import { eq } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { getDb } from "./db";

const { appMeta } = schema;

/**
 * System operations reads for the admin operations page: the latest
 * email-deliverability check. System-scoped, not personal, so it lives
 * outside the UserScope isolation boundary. No secret is ever returned.
 * Database backups run on the host (see scripts/backup-*.sh), not in the
 * app, so there is nothing backup-related to read here.
 */

export type DeliverabilityStatus = {
  domain: string;
  checkedAt: string;
  mx: { ok: boolean; detail: string };
  spf: { ok: boolean; detail: string };
  dmarc: { ok: boolean; detail: string };
  dkim: { ok: boolean; detail: string };
  healthy: boolean;
  inconclusive?: boolean;
  failures: string[];
} | null;

export async function deliverabilityStatus(): Promise<DeliverabilityStatus> {
  const rows = await getDb().select().from(appMeta).where(eq(appMeta.key, "health.deliverability")).limit(1);
  return (rows[0]?.value as DeliverabilityStatus) ?? null;
}

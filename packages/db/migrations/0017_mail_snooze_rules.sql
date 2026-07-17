ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_messages_snooze_idx" ON "mail_messages" ("snoozed_until") WHERE "snoozed_until" IS NOT NULL;

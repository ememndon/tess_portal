ALTER TABLE "mail_outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "sent_at" timestamp with time zone;
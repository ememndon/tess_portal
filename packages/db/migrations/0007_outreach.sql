ALTER TABLE "outreach_messages" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "from_email" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "to_email" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "variant" text;--> statement-breakpoint
CREATE INDEX "outreach_messages_ext_idx" ON "outreach_messages" USING btree ("user_id","external_id");
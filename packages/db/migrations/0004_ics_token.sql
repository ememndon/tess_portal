ALTER TABLE "user_settings" ADD COLUMN "ics_token" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_ics_token_unique" UNIQUE("ics_token");
CREATE TABLE "currency_rates" (
	"base" text NOT NULL,
	"target" text NOT NULL,
	"rate" numeric NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currency_rates_base_target_pk" PRIMARY KEY("base","target")
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"source_name" text NOT NULL,
	"status" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"error" text,
	"duration_ms" integer,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "saved" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "signals" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_runs_source_idx" ON "discovery_runs" USING btree ("source_id","ran_at");--> statement-breakpoint
CREATE INDEX "jobs_user_saved_idx" ON "jobs" USING btree ("user_id","saved");--> statement-breakpoint
CREATE INDEX "jobs_fingerprint_idx" ON "jobs" USING btree ("user_id","fingerprint");
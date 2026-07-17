CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" numeric,
	"status" text DEFAULT 'created' NOT NULL,
	"location" text,
	"drive_file_id" text,
	"error" text,
	"verify_status" text,
	"verify_detail" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backups_created_idx" ON "backups" USING btree ("created_at");
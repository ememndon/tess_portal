CREATE TABLE "monitored_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"country_code" text,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"content_hash" text,
	"snapshot" text,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitored_pages_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE INDEX "monitored_pages_kind_idx" ON "monitored_pages" USING btree ("kind");
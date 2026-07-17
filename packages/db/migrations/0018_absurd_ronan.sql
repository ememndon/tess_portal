CREATE TABLE "ats_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text NOT NULL,
	"adapter" text,
	"config" jsonb,
	"source_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ats_resolution_country_name_uq" UNIQUE("country_code","normalized_name")
);

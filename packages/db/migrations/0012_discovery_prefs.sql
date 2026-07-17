ALTER TABLE "user_settings" ADD COLUMN "role_query" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "require_sponsorship" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "require_family_reunification" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DELETE FROM "sponsor_registry" a USING "sponsor_registry" b WHERE a.ctid < b.ctid AND a."country_code" = b."country_code" AND a."normalized_name" = b."normalized_name";--> statement-breakpoint
ALTER TABLE "sponsor_registry" ADD CONSTRAINT "sponsor_registry_country_name_uq" UNIQUE("country_code","normalized_name");--> statement-breakpoint
DELETE FROM "sources" WHERE "type" = 'crawl';

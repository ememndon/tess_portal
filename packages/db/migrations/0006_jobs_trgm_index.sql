-- Trigram index on job title and company for fast pg_trgm similarity
-- during cross-source dedup.
CREATE INDEX IF NOT EXISTS jobs_title_trgm_idx ON jobs USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_company_trgm_idx ON jobs USING gin (company_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sponsor_registry_norm_trgm_idx ON sponsor_registry USING gin (normalized_name gin_trgm_ops);

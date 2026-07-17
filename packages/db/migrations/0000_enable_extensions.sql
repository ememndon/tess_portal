-- Enable the extensions the platform is built on.
-- pgvector powers embeddings (match scoring, dedup, semantic memory).
-- pg_trgm powers fuzzy matching (dedup, company and sponsor matching).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;

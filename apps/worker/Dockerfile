# tessportal-worker: BullMQ workers, scrapers, scheduled runs, backups.
# Playwright base image ships with browsers installed for Phase 4 crawling.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
ENV NODE_ENV=production \
    TRANSFORMERS_CACHE=/app/.cache/transformers \
    CRAWLEE_STORAGE_DIR=/tmp/crawlee \
    CRAWLEE_PURGE_ON_START=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/worker -w packages/db -w packages/shared
COPY --chown=pwuser:pwuser packages ./packages
COPY --chown=pwuser:pwuser apps/worker ./apps/worker
# local embedding model cache, writable by the non-root runtime user
RUN mkdir -p /app/.cache/transformers /tmp/crawlee && chown -R pwuser:pwuser /app/.cache
USER pwuser
CMD ["./node_modules/.bin/tsx", "apps/worker/src/index.ts"]

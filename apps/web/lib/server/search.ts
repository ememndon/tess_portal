import { Meilisearch as MeiliSearch } from "meilisearch";
import { getLogger } from "./health";

/**
 * Meilisearch sync and query. Every document carries userId and every
 * search filters by it server-side, so isolation holds in search too.
 * Sync failures never break the write path; they log and move on.
 */

export const SEARCH_INDEXES = ["jobs", "companies", "contacts", "documents"] as const;
export type SearchIndex = (typeof SEARCH_INDEXES)[number];

const g = globalThis as unknown as { __tpMeili?: MeiliSearch; __tpMeiliReady?: Promise<void> };

export function getMeili(): MeiliSearch {
  g.__tpMeili ??= new MeiliSearch({
    host: process.env.MEILI_HOST ?? "",
    apiKey: process.env.MEILI_MASTER_KEY ?? "",
  });
  return g.__tpMeili;
}

/** Idempotent index setup: filterable userId, sensible ranking. */
export function ensureIndexes(): Promise<void> {
  g.__tpMeiliReady ??= (async () => {
    const meili = getMeili();
    for (const name of SEARCH_INDEXES) {
      await meili.createIndex(name, { primaryKey: "id" }).catch(() => {});
      await meili.index(name).updateSettings({
        filterableAttributes: ["userId"],
        sortableAttributes: ["updatedAt"],
        typoTolerance: {
          minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
        },
      });
    }
  })().catch((err) => {
    g.__tpMeiliReady = undefined;
    throw err;
  });
  return g.__tpMeiliReady;
}

export async function syncSearchDoc(
  index: SearchIndex,
  doc: { id: string; userId: string } & Record<string, unknown>,
) {
  try {
    await ensureIndexes();
    await getMeili().index(index).addDocuments([doc]);
  } catch (err) {
    getLogger().error({ err: (err as Error).message, index }, "search sync failed");
  }
}

export async function removeSearchDoc(index: SearchIndex, id: string) {
  try {
    await getMeili().index(index).deleteDocument(id);
  } catch (err) {
    getLogger().error({ err: (err as Error).message, index }, "search remove failed");
  }
}

/** Removes every document of a user across all indexes (account deletion). */
export async function removeUserFromSearch(userId: string) {
  try {
    await ensureIndexes();
    const meili = getMeili();
    for (const name of SEARCH_INDEXES) {
      await meili.index(name).deleteDocuments({ filter: `userId = "${userId}"` });
    }
  } catch (err) {
    getLogger().error({ err: (err as Error).message }, "search user purge failed");
  }
}

export async function searchAll(userId: string, query: string) {
  await ensureIndexes();
  const meili = getMeili();
  const filter = `userId = "${userId}"`;
  const { results } = await meili.multiSearch({
    queries: SEARCH_INDEXES.map((indexUid) => ({
      indexUid,
      q: query,
      filter,
      limit: 5,
      attributesToRetrieve: ["id", "title", "subtitle", "href"],
    })),
  });
  return SEARCH_INDEXES.map((name, i) => ({
    index: name,
    hits: (results[i]?.hits ?? []) as { id: string; title: string; subtitle?: string; href: string }[],
  }));
}

import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { DISCOVER_PAGE_SIZE, scopeFor, type TargetCountry } from "@/lib/server/dal";
import { formatSalaryNative } from "@/lib/server/money";
import { DiscoverClient } from "./discover-client";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{
    all?: string;
    country?: string;
    source?: string;
    sponsorship?: string;
    q?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const sp = await searchParams;
  const reveal = sp.all === "1";
  const filters = {
    country: sp.country?.trim() || null,
    source: sp.source?.trim() || null,
    sponsorship: sp.sponsorship?.trim() || null,
    q: sp.q?.trim() || null,
    sort: sp.sort === "recent" ? "recent" : null,
  };
  const query = { reveal, ...filters };
  const [total, settings, gatedCount, facets] = await Promise.all([
    scope.countDiscoveredMatching(query),
    scope.getSettings(),
    scope.countGatedDiscovered(),
    scope.discoverFacets(),
  ]);

  // clamp the requested page so a stale ?page= (or a shrinking result set) still shows rows
  const pageCount = Math.max(1, Math.ceil(total / DISCOVER_PAGE_SIZE));
  const requested = Number.parseInt(sp.page ?? "1", 10);
  const page = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), pageCount);

  const discovered = await scope.listDiscovered({
    ...query,
    limit: DISCOVER_PAGE_SIZE,
    offset: (page - 1) * DISCOVER_PAGE_SIZE,
  });

  const supported = (settings.targetCountries as TargetCountry[]).filter((c) => c.code).length;

  return (
    <DiscoverClient
      hasSupportedCountries={supported > 0}
      reveal={reveal}
      gatedCount={gatedCount}
      facets={facets}
      filters={filters}
      page={page}
      pageCount={pageCount}
      pageSize={DISCOVER_PAGE_SIZE}
      total={total}
      jobs={discovered.map((j) => {
        // always the currency the employer quoted — never converted
        const salary = formatSalaryNative(j) ?? j.salaryRaw;
        return {
          id: j.id,
          title: j.title,
          companyName: j.companyName,
          location: j.location,
          countryCode: j.countryCode,
          remote: j.remote,
          url: j.url,
          source: j.source,
          salary,
          sponsorship: j.sponsorship,
          matchScore: j.matchScore,
          matchExplanation: (j.matchExplanation as { reasons?: string[] } | null)?.reasons ?? [],
          signals: (j.signals as { label: string; severity: string }[] | null) ?? [],
          postedAt: j.postedAt?.toISOString() ?? null,
        };
      })}
    />
  );
}

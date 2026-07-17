import type { Metadata } from "next";
import { DateTime } from "luxon";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { recommendCompanies } from "@/lib/intel/recommend";
import type { CompanyBrief } from "@/lib/intel/brief";
import { CompaniesClient } from "./companies-client";

export const metadata: Metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const [companies, recommendations, signals] = await Promise.all([
    scope.listCompanies(),
    recommendCompanies(user.id),
    scope.listSignals(30),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <div>
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Companies</h1>
        <p className="text-[11.5px] text-muted">
          Track a company, watch it for hiring signals, and run a sourced research brief. Tess also
          recommends companies from your own pipeline.
        </p>
      </div>
      <CompaniesClient
        companies={companies.map((c) => ({
          id: c.id,
          name: c.name,
          website: c.website,
          sponsorStatus: c.sponsorStatus,
          watched: c.watched,
          brief: ((c.brief as { research?: CompanyBrief } | null)?.research) ?? null,
        }))}
        recommendations={recommendations}
        signals={signals.map((s) => ({
          id: s.id,
          companyName: s.companyName,
          type: s.type,
          payload: s.payload as Record<string, unknown> | null,
          detectedAt: DateTime.fromJSDate(s.detectedAt).toFormat("d LLL, HH:mm"),
        }))}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { computeInsights } from "@/lib/intel/insights";
import { salaryBands } from "@/lib/intel/salary";
import { STAGES } from "@/lib/stages";
import { AnalyticsClient } from "./analytics-client";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const [funnel, channels, response, insightData, bands] = await Promise.all([
    scope.funnelStats(),
    scope.channelEffectiveness(),
    scope.responseTimePatterns(),
    computeInsights(user.id),
    salaryBands(user.id),
  ]);

  const funnelData = STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    count: funnel[s.key] ?? 0,
    color: s.color,
  }));
  const totalSaved = funnelData.reduce((sum, s) => sum + s.count, 0);

  return (
    <AnalyticsClient
      funnel={funnelData}
      totalSaved={totalSaved}
      channels={channels}
      response={response}
      insights={insightData.insights}
      totalSamples={insightData.totalSamples}
      bands={bands.slice(0, 8)}
    />
  );
}

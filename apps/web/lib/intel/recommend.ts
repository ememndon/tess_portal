import { scopeFor } from "@/lib/server/dal";
import { confirmedSkillSet, profileSchema } from "@/lib/cv/schema";

/**
 * Proactive company recommendations, computed from the user's own data,
 * no external calls. It ranks companies that appear in the user's
 * discovered and saved jobs but that they do not yet track, by how well
 * their roles fit the confirmed profile, match score, and sponsorship.
 * Every recommendation states its reason, grounded in the data.
 */

export type CompanyRecommendation = {
  companyName: string;
  countryCode: string | null;
  roleCount: number;
  matchScore: number;
  sponsorship: string;
  sampleTitle: string;
  reasons: string[];
  score: number;
};

export async function recommendCompanies(userId: string, limit = 8): Promise<CompanyRecommendation[]> {
  const scope = scopeFor(userId);
  const [aggregates, confirmed, settings] = await Promise.all([
    scope.companyAggregates(),
    scope.getConfirmedProfileData(),
    scope.getSettings(),
  ]);

  const profile = confirmed ? profileSchema.parse(confirmed) : null;
  const skills = profile ? confirmedSkillSet(profile) : new Set<string>();
  const targetCodes = new Set(
    (settings.targetCountries as { code: string | null }[]).map((c) => c.code).filter(Boolean) as string[],
  );

  const candidates = aggregates.filter((a) => !a.tracked && a.roleCount > 0);
  const scored = candidates.map((c) => {
    const reasons: string[] = [];
    let score = 0;

    // fit from confirmed skills appearing in the sample role title
    const titleWords = c.sampleTitle.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
    const skillHits = [...skills].filter((s) => titleWords.includes(s));
    if (skillHits.length > 0) {
      score += skillHits.length * 12;
      reasons.push(`role titles match your ${skillHits.slice(0, 3).join(", ")}`);
    }

    if (c.bestMatch >= 70) {
      score += c.bestMatch / 2;
      reasons.push(`a role scored ${c.bestMatch} against your profile`);
    }

    if (c.roleCount > 1) {
      score += Math.min(c.roleCount, 6) * 4;
      reasons.push(`${c.roleCount} open roles on file`);
    }

    if (c.sponsorship === "confirmed") {
      score += 25;
      reasons.push("on the sponsor register");
    } else if (c.sponsorship === "inferred") {
      score += 10;
      reasons.push("sponsorship looks likely");
    }

    if (c.countryCode && targetCodes.has(c.countryCode)) {
      score += 8;
      reasons.push(`in your target market ${c.countryCode}`);
    }

    if (reasons.length === 0) reasons.push(`${c.roleCount} role${c.roleCount === 1 ? "" : "s"} on file`);

    return {
      companyName: c.companyName,
      countryCode: c.countryCode,
      roleCount: c.roleCount,
      matchScore: c.bestMatch,
      sponsorship: c.sponsorship,
      sampleTitle: c.sampleTitle,
      reasons,
      score: Math.round(score),
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

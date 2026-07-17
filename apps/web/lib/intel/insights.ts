import { scopeFor } from "@/lib/server/dal";

/**
 * Closed-loop learning, version one. It correlates the features of the
 * user's own applications and outreach with their recorded outcomes and
 * surfaces findings as insights. It is deliberately honest about sample
 * size: with little data it says so and asserts nothing. Only patterns
 * that clear a real sample threshold are allowed to feed back into the
 * tailoring and outreach prompts, and even then they ride in labeled as
 * low-confidence. Nothing here is presented as established fact.
 */

export type Insight = {
  statement: string;
  n: number;
  confidence: "insufficient" | "low" | "moderate";
  actionable: boolean;
  detail: string;
};

const MIN_GROUP = 2; // each side of a comparison needs at least this many
const LOW_AT = 6; // total sample for a low-confidence signal
const MODERATE_AT = 16; // total sample before we call it moderate

function confidenceFor(total: number): Insight["confidence"] {
  if (total >= MODERATE_AT) return "moderate";
  if (total >= LOW_AT) return "low";
  return "insufficient";
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

type Sample = Awaited<ReturnType<ReturnType<typeof scopeFor>["outcomeSamples"]>>[number];

/** Compares two groups on their interview-reach rate. */
function compareOnInterview(
  samples: Sample[],
  label: string,
  has: (s: Sample) => boolean,
  withText: string,
  withoutText: string,
): Insight | null {
  const withGroup = samples.filter(has);
  const withoutGroup = samples.filter((s) => !has(s));
  if (withGroup.length < MIN_GROUP || withoutGroup.length < MIN_GROUP) return null;
  const withRate = pct(withGroup.filter((s) => s.reachedInterview).length, withGroup.length);
  const withoutRate = pct(withoutGroup.filter((s) => s.reachedInterview).length, withoutGroup.length);
  const total = samples.length;
  const conf = confidenceFor(total);
  const delta = withRate - withoutRate;
  const direction = delta > 0 ? "higher" : delta < 0 ? "lower" : "the same";
  return {
    statement: `${label}: ${withText} reached interview ${withRate}% of the time vs ${withoutRate}% ${withoutText}.`,
    n: total,
    confidence: conf,
    actionable: conf !== "insufficient" && Math.abs(delta) >= 10,
    detail: `${Math.abs(delta)} points ${direction} with ${withGroup.length} vs ${withoutGroup.length} applications on file.`,
  };
}

export async function computeInsights(userId: string): Promise<{ insights: Insight[]; totalSamples: number }> {
  const scope = scopeFor(userId);
  const [samples, channels] = await Promise.all([scope.outcomeSamples(), scope.channelEffectiveness()]);

  const insights: Insight[] = [];

  const tailored = compareOnInterview(
    samples,
    "Tailored CV",
    (s) => s.hasTailoredCv,
    "applications with a tailored CV",
    "without one",
  );
  if (tailored) insights.push(tailored);

  const cover = compareOnInterview(
    samples,
    "Cover letter",
    (s) => s.hasCoverLetter,
    "applications with a cover letter",
    "without one",
  );
  if (cover) insights.push(cover);

  const outreach = compareOnInterview(
    samples,
    "Outreach",
    (s) => s.outreachCount > 0,
    "applications backed by outreach",
    "with none",
  );
  if (outreach) insights.push(outreach);

  // channel effectiveness as its own insight when a channel has volume
  const topChannel = channels
    .filter((c) => c.applied >= MIN_GROUP)
    .map((c) => ({ ...c, rate: pct(c.interview, c.applied) }))
    .sort((a, b) => b.rate - a.rate)[0];
  if (topChannel) {
    // the sample is this channel's own applied count, not the cross-channel
    // total, so the confidence label reflects the number actually behind the rate
    const conf = confidenceFor(topChannel.applied);
    insights.push({
      statement: `Your ${topChannel.source} sourced jobs converted to interview at ${topChannel.rate}% once applied.`,
      n: topChannel.applied,
      confidence: conf,
      actionable: conf !== "insufficient",
      detail: `${topChannel.interview} of ${topChannel.applied} applied ${topChannel.source} jobs reached interview.`,
    });
  }

  return { insights, totalSamples: samples.length };
}

/**
 * The feedback path: high-enough-confidence patterns rendered as a short
 * block for the tailoring and outreach system prompts. Always labeled
 * low-confidence and drawn only from the user's own history. Returns an
 * empty string when there is not enough data, so prompts stay clean.
 */
export async function learnedPatternsForPrompt(userId: string): Promise<string> {
  const { insights } = await computeInsights(userId);
  const usable = insights.filter((i) => i.actionable && i.confidence !== "insufficient");
  if (usable.length === 0) return "";
  const lines = usable.slice(0, 4).map((i) => `- ${i.statement} (${i.confidence} confidence, n=${i.n})`);
  return `Low-confidence patterns from this user's own history, use as gentle hints only, never as rules and never mention them as facts:\n${lines.join("\n")}`;
}

import { schema, type Db } from "@tessportal/db";
import { seedSources } from "./discovery/sources";
import { seedSponsors } from "./discovery/sponsors";

const { providers, modelRouting, capConfig, monitoredPages } = schema;

/**
 * Official immigration and sponsor-register pages the visa monitor
 * watches for supported markets. Seeded once; the monitor stores each
 * page's baseline hash on first fetch and alerts everyone on a change.
 * onConflictDoNothing keeps stored hashes and snapshots intact across
 * boots.
 */
const MONITORED_PAGE_SEED = [
  { kind: "immigration", countryCode: "IE", label: "Ireland employment permits", url: "https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/" },
  { kind: "immigration", countryCode: "NL", label: "Netherlands highly skilled migrant", url: "https://ind.nl/en/residence-permits/work/highly-skilled-migrant" },
  { kind: "register", countryCode: "NL", label: "Netherlands public register of recognised sponsors", url: "https://ind.nl/en/public-register-recognised-sponsors" },
  { kind: "immigration", countryCode: "NZ", label: "New Zealand accredited employer work visa", url: "https://www.immigration.govt.nz/employ-migrants/hire-a-candidate-outside-new-zealand/accredited-employer-work-visa" },
  { kind: "immigration", countryCode: "AU", label: "Australia skilled visas", url: "https://immi.homeaffairs.gov.au/visas/working-in-australia" },
  { kind: "immigration", countryCode: "GB", label: "UK skilled worker visa", url: "https://www.gov.uk/skilled-worker-visa" },
  { kind: "register", countryCode: "GB", label: "UK register of licensed sponsors", url: "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" },
];

/**
 * Idempotent platform data seeding on worker boot: the provider chain,
 * default activity routing, and the cap row. Routing rows are only
 * inserted when missing so user edits always win.
 */

const PROVIDER_SEED = [
  { id: "cerebras", displayName: "Cerebras", chainOrder: 1, freeTier: true, dailyLimits: { requests: 14400, tokens: 1000000 } },
  { id: "groq", displayName: "Groq", chainOrder: 2, freeTier: true, dailyLimits: { requests: 14400, tokens: 500000 } },
  { id: "zhipu", displayName: "Zhipu GLM", chainOrder: 3, freeTier: true, dailyLimits: { requests: 5000, tokens: 2000000 } },
  { id: "deepinfra", displayName: "DeepInfra", chainOrder: 4, freeTier: false, dailyLimits: null },
  { id: "openai", displayName: "OpenAI", chainOrder: 5, freeTier: false, dailyLimits: null },
  { id: "anthropic", displayName: "Anthropic", chainOrder: 6, freeTier: false, dailyLimits: null },
];

const ROUTING_SEED = [
  { activity: "chat", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "cv_parse", provider: "auto", model: "auto" },
  { activity: "cv_tailoring", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "cover_letter", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "form_answers", provider: "auto", model: "auto" },
  { activity: "outreach_draft", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "interview_prep", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "mock_interview", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "negotiation", provider: "anthropic", model: "claude-sonnet-4-5" },
  { activity: "company_brief", provider: "auto", model: "auto" },
  { activity: "paste_parse", provider: "auto", model: "auto" },
  { activity: "classification", provider: "auto", model: "auto" },
  { activity: "summarize", provider: "auto", model: "auto" },
  { activity: "playbook_step", provider: "auto", model: "auto" },
];

export async function seedPlatformData(db: Db) {
  for (const p of PROVIDER_SEED) {
    await db
      .insert(providers)
      .values(p)
      .onConflictDoUpdate({
        target: providers.id,
        set: { displayName: p.displayName, chainOrder: p.chainOrder, freeTier: p.freeTier },
      });
  }
  for (const r of ROUTING_SEED) {
    await db.insert(modelRouting).values(r).onConflictDoNothing();
  }
  await db.insert(capConfig).values({ id: 1 }).onConflictDoNothing();
  for (const p of MONITORED_PAGE_SEED) {
    await db.insert(monitoredPages).values(p).onConflictDoNothing();
  }
  await seedSources(db);
  await seedSponsors(db);
}

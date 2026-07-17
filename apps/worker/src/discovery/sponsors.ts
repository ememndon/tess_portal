import { eq, sql } from "drizzle-orm";
import { fetch as undiciFetch } from "undici";
import { load } from "cheerio";
import ExcelJS from "exceljs";
import { schema, type Db } from "@tessportal/db";
import type { Logger } from "@tessportal/shared";
import { normalize } from "./dedup";
import { isRegisterCountry } from "./countries";
import { recordDiscoveryRun } from "./sources";

/**
 * Sponsor register ingestion and matching. Official government registers
 * of employers licensed to sponsor a work visa are downloaded and stored
 * per country; a company on a posting is matched against them so
 * "this employer can sponsor" is verified, not guessed. Countries with no
 * public register (or none ingestible, e.g. New Zealand) fall back to the
 * curated seed and posting-text inference (handled in the run).
 *
 * Registers ingested (verified 2026-07-07):
 *  - GB: Home Office CSV, discovered via the gov.uk content API (~daily)
 *  - IE: DETE employment-permit XLSX per year (monthly)
 *  - CA: TFWP positive-LMIA XLSX, newest quarter via the CKAN API
 *  - NL: IND recognised-sponsors, a single server-rendered HTML table
 *  - NZ: no bulk list exists — seed + text inference only
 */

// Cold-start / fallback ONLY. These are small, hand-picked, tech-skewed subsets
// — NOT the official registers. For GB/IE/CA/NL the weekly ingestSponsors run
// replaces them wholesale with the full government register (registerData.source
// becomes "gov"). For NZ no bulk register is published, so this seed is the
// standing stand-in — a known limitation that skews NZ sponsorship toward these
// tech firms until a broader source exists. Do not read these as authoritative.
const SEED: Record<string, string[]> = {
  NL: [
    "Booking.com", "ASML", "Adyen", "Philips", "ING Bank", "Shell", "Uber", "Optiver",
    "Databricks", "Elastic", "Mollie", "Picnic", "Bunq", "TomTom", "NXP Semiconductors",
    "Coolblue", "Miro", "Backbase", "MessageBird", "Framer",
  ],
  IE: [
    "Google Ireland", "Meta", "Stripe", "Workday", "Intercom", "Microsoft Ireland",
    "Amazon Ireland", "LinkedIn Ireland", "HubSpot", "Salesforce", "SAP Ireland",
    "Fidelity Investments", "Mastercard", "Analog Devices", "Arden Labs",
  ],
  NZ: [
    "Xero", "Datacom", "Trade Me", "Vend", "Pushpay", "Rocket Lab", "Fisher & Paykel",
    "Spark New Zealand", "Southern Cross Digital", "Vista Group",
  ],
};

export async function seedSponsors(db: Db): Promise<void> {
  for (const [country, names] of Object.entries(SEED)) {
    for (const name of names) {
      await db
        .insert(schema.sponsorRegistry)
        .values({
          countryCode: country,
          companyName: name,
          normalizedName: normalize(name),
          registerData: { source: "seed" },
        })
        .onConflictDoNothing();
    }
  }
}

/* ---------- official register download + parse ---------- */

const GOV_UA = "TessPortal/1.0 (+https://career.tessconsole.cloud)";

async function getText(url: string): Promise<string> {
  const res = await undiciFetch(url, {
    headers: { "User-Agent": GOV_UA, Accept: "text/csv,text/html,application/xhtml+xml,*/*" },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function getJson(url: string): Promise<unknown> {
  const res = await undiciFetch(url, {
    headers: { "User-Agent": GOV_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function getBuffer(url: string): Promise<Buffer> {
  const res = await undiciFetch(url, {
    headers: { "User-Agent": GOV_UA },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Minimal RFC-4180 CSV parser: handles quotes, embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function columnNames(ws: ExcelJS.Worksheet, headerRowIndex: number, wanted: string): number {
  let col = 1;
  const header = ws.getRow(headerRowIndex);
  header.eachCell((cell, c) => {
    if (String(cell.text).trim().toLowerCase() === wanted.toLowerCase()) col = c;
  });
  return col;
}

/** UK Home Office register of licensed sponsors (workers). Native CSV. */
async function fetchUK(): Promise<string[]> {
  const meta = (await getJson(
    "https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers",
  )) as { details?: { attachments?: { url?: string; content_type?: string }[] } };
  const att = (meta.details?.attachments ?? []).find(
    (a) => a.content_type === "text/csv" || /\.csv(\?|$)/i.test(a.url ?? ""),
  );
  if (!att?.url) throw new Error("UK: no CSV attachment in content API");
  const rows = parseCsv(await getText(att.url));
  if (rows.length < 2) throw new Error("UK: empty CSV");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = header.indexOf("organisation name");
  const col = idx >= 0 ? idx : 0;
  return rows.slice(1).map((r) => (r[col] ?? "").trim());
}

/** Ireland DETE employment permits issued to companies. Yearly XLSX. */
async function fetchIE(): Promise<string[]> {
  const year = new Date().getFullYear();
  let lastErr: Error | null = null;
  for (const y of [year, year - 1]) {
    try {
      const buf = await getBuffer(
        `https://enterprise.gov.ie/en/publications/publication-files/employment-permits-issued-to-companies-${y}.xlsx`,
      );
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const ws = wb.worksheets[0];
      const col = columnNames(ws, 1, "Employer Name");
      const names: string[] = [];
      ws.eachRow((row, n) => {
        if (n === 1) return; // header
        const v = String(row.getCell(col).text ?? "").trim();
        if (v) names.push(v);
      });
      if (names.length > 0) return names;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("IE: no permits file");
}

/** Canada TFWP positive-LMIA employers. Newest quarter XLSX via CKAN. */
async function fetchCA(): Promise<string[]> {
  const pkg = (await getJson(
    "https://open.canada.ca/data/api/action/package_show?id=90fed587-1364-4f33-a9ee-208181dc0b97",
  )) as { result?: { resources?: { url?: string; name?: string }[] } };
  const resources = (pkg.result?.resources ?? []).filter((r) =>
    /_pos_en\.xlsx$/i.test(r.url ?? r.name ?? ""),
  );
  resources.sort((a, b) => (b.name ?? b.url ?? "").localeCompare(a.name ?? a.url ?? ""));
  const chosen = resources[0];
  if (!chosen?.url) throw new Error("CA: no pos_en xlsx resource");
  const buf = await getBuffer(chosen.url);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  // row 1 is a title, row 2 is the header, data from row 3
  const col = columnNames(ws, 2, "Employer") || 3;
  const names: string[] = [];
  ws.eachRow((row, n) => {
    if (n <= 2) return;
    const v = String(row.getCell(col).text ?? "").trim();
    if (v) names.push(v);
  });
  return names;
}

/** Netherlands IND recognised sponsors (labour). One static HTML table. */
async function fetchNL(): Promise<string[]> {
  const html = await getText("https://ind.nl/en/public-register-recognised-sponsors/public-register-work");
  const $ = load(html);
  const names: string[] = [];
  $("table tr").each((_, tr) => {
    const first = $(tr).find("td").first().text().trim();
    if (first) names.push(first);
  });
  return names;
}

type RegisterSpec = { country: string; label: string; fetch: () => Promise<string[]>; minRows: number };

const REGISTERS: RegisterSpec[] = [
  { country: "GB", label: "UK sponsor register", fetch: fetchUK, minRows: 1000 },
  { country: "IE", label: "Ireland employment permits", fetch: fetchIE, minRows: 200 },
  { country: "CA", label: "Canada positive LMIA", fetch: fetchCA, minRows: 500 },
  { country: "NL", label: "Netherlands recognised sponsors", fetch: fetchNL, minRows: 500 },
];

function dedupeNames(names: string[]): { companyName: string; normalizedName: string }[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const norm = normalize(name);
    if (!norm) continue;
    if (!seen.has(norm)) seen.set(norm, name);
  }
  return [...seen.entries()].map(([normalizedName, companyName]) => ({ companyName, normalizedName }));
}

/** Replaces a country's register rows with a fresh government list. */
async function replaceCountry(
  db: Db,
  country: string,
  rows: { companyName: string; normalizedName: string }[],
): Promise<void> {
  await db.delete(schema.sponsorRegistry).where(eq(schema.sponsorRegistry.countryCode, country));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((r) => ({
      countryCode: country,
      companyName: r.companyName,
      normalizedName: r.normalizedName,
      registerData: { source: "gov" },
    }));
    await db.insert(schema.sponsorRegistry).values(batch).onConflictDoNothing();
  }
}

/**
 * Downloads and stores the official registers, replacing each country's
 * rows on success and degrading gracefully (keeping existing data + the
 * seed) when a government source is unreachable. Runs weekly.
 */
export async function ingestSponsors(db: Db, log?: Logger): Promise<string> {
  await seedSponsors(db);
  let ingested = 0;
  for (const reg of REGISTERS) {
    const startedAt = Date.now();
    try {
      const rows = dedupeNames(await reg.fetch());
      if (rows.length < reg.minRows) {
        throw new Error(`only ${rows.length} rows (min ${reg.minRows}) — treating as a bad fetch`);
      }
      await replaceCountry(db, reg.country, rows);
      ingested += rows.length;
      log?.info({ country: reg.country, count: rows.length }, "sponsor register ingested");
      await recordDiscoveryRun(db, {
        sourceId: null,
        sourceName: reg.label,
        status: "success",
        fetched: rows.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      log?.warn({ country: reg.country, err: (err as Error).message }, "sponsor register ingest failed");
      await recordDiscoveryRun(db, {
        sourceId: null,
        sourceName: reg.label,
        status: "failed",
        fetched: 0,
        error: (err as Error).message.slice(0, 300),
        durationMs: Date.now() - startedAt,
      });
    }
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.sponsorRegistry);
  return `sponsor register holds ${Number(n)} companies (ingested ${ingested} this run)`;
}

/* ---------- matching ---------- */

export type SponsorMatch = { status: "confirmed" | "inferred" | "unknown"; matchedName?: string };
export type SponsorIndex = Map<string, { companyName: string; normalizedName: string }[]>;

/**
 * Token-containment match: a register name confirms when every distinctive
 * token of it appears in the company name (so "Stripe" confirms "Stripe
 * Payments Ireland"), or the company name is a substring of a register name.
 */
function matchAgainst(
  rows: { companyName: string; normalizedName: string }[],
  companyName: string,
): SponsorMatch {
  const norm = normalize(companyName);
  if (!norm) return { status: "unknown" };
  const companyTokens = new Set(norm.split(" ").filter((t) => t.length >= 3));
  let best: { name: string; score: number } | null = null;
  for (const r of rows) {
    const regTokens = r.normalizedName.split(" ").filter((t) => t.length >= 3);
    if (regTokens.length === 0) continue;
    const contained = regTokens.every((t) => companyTokens.has(t));
    const reverse = r.normalizedName.includes(norm);
    const score = contained || reverse
      ? 1
      : regTokens.filter((t) => companyTokens.has(t)).length / regTokens.length;
    if (!best || score > best.score) best = { name: r.companyName, score };
  }
  if (best && best.score >= 0.8) return { status: "confirmed", matchedName: best.name };
  return { status: "unknown" };
}

/**
 * Loads register rows for the given countries once (used per discovery run
 * so matching is in-memory, not a query per candidate job).
 */
export async function loadSponsorIndex(db: Db, countryCodes: string[]): Promise<SponsorIndex> {
  const index: SponsorIndex = new Map();
  const registerCodes = countryCodes.filter((c) => isRegisterCountry(c));
  for (const code of registerCodes) {
    const rows = await db
      .select({
        companyName: schema.sponsorRegistry.companyName,
        normalizedName: schema.sponsorRegistry.normalizedName,
      })
      .from(schema.sponsorRegistry)
      .where(eq(schema.sponsorRegistry.countryCode, code));
    index.set(code, rows);
  }
  return index;
}

/** In-memory match against a preloaded index. */
export function matchSponsorIndexed(
  index: SponsorIndex,
  companyName: string,
  countryCode: string | null,
): SponsorMatch {
  if (!countryCode) return { status: "unknown" };
  const rows = index.get(countryCode);
  if (!rows || rows.length === 0) return { status: "unknown" };
  return matchAgainst(rows, companyName);
}

/**
 * DB-backed single match (loads the country's rows on demand). Used by
 * tests and ad-hoc callers; the discovery run uses the preloaded index.
 */
export async function matchSponsor(
  db: Db,
  companyName: string,
  countryCode: string | null,
): Promise<SponsorMatch> {
  if (!countryCode || !isRegisterCountry(countryCode)) return { status: "unknown" };
  const rows = await db
    .select({
      companyName: schema.sponsorRegistry.companyName,
      normalizedName: schema.sponsorRegistry.normalizedName,
    })
    .from(schema.sponsorRegistry)
    .where(eq(schema.sponsorRegistry.countryCode, countryCode));
  return matchAgainst(rows, companyName);
}

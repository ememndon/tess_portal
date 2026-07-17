import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { schema } from "@tessportal/db";
import { requireOnboardedUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { listPendingInvites, listSystemLog, listUsers } from "@/lib/server/admin";
import { listSecretMeta } from "@/lib/server/vault";
import { getCap, isGloballyPaused, monthKey, monthlySpend, providerDailyUsage, providerLimits } from "@/lib/ai/meter";
import { PROVIDERS as CATALOG_PROVIDERS } from "@/lib/ai/catalog";
import { VaultSecretForm } from "@/components/vault-secret-form";
import { GateRotationForm, InviteForm } from "./admin-forms";
import { CapForm, DailyTrendChart, GlobalPauseToggle, Meter } from "./cost-client";
import { ScheduleWindowForm, SourceRow } from "./discovery-client";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const PROVIDERS = ["cerebras", "groq", "zhipu", "deepinfra", "openai", "anthropic"] as const;

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-baseline gap-2 p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">{title}</h2>
        {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export default async function AdminPage() {
  await requireOnboardedUser();
  const db = getDb();
  const users = await listUsers();
  const invites = await listPendingInvites();
  const systemLog = await listSystemLog(50);
  const platformVault = await listSecretMeta(null);
  const meta = (kind: string, name: string) =>
    platformVault.find((m) => m.kind === kind && m.name === name);

  // cost dashboard data
  const [cap, spend, paused] = await Promise.all([getCap(), monthlySpend(), isGloballyPaused()]);
  const capUsd = Number(cap.monthlyCapUsd);
  const { usageEvents } = schema;
  const monthFilter = sql`to_char(${usageEvents.createdAt}, 'YYYY-MM') = ${monthKey()}`;
  const [perUser, perFeature, perProvider, daily] = await Promise.all([
    db
      .select({
        email: schema.users.email,
        usd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
        calls: sql<number>`count(*)`,
      })
      .from(usageEvents)
      .leftJoin(schema.users, sql`${schema.users.id} = ${usageEvents.userId}`)
      .where(monthFilter)
      .groupBy(schema.users.email),
    db
      .select({ feature: usageEvents.feature, usd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`, calls: sql<number>`count(*)` })
      .from(usageEvents)
      .where(monthFilter)
      .groupBy(usageEvents.feature),
    db
      .select({ provider: usageEvents.provider, usd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`, calls: sql<number>`count(*)` })
      .from(usageEvents)
      .where(monthFilter)
      .groupBy(usageEvents.provider),
    db
      .select({ day: sql<string>`to_char(${usageEvents.createdAt}, 'MM-DD')`, usd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
      .from(usageEvents)
      .where(sql`${usageEvents.createdAt} > now() - interval '30 days'`)
      .groupBy(sql`to_char(${usageEvents.createdAt}, 'MM-DD')`)
      .orderBy(sql`to_char(${usageEvents.createdAt}, 'MM-DD')`),
  ]);
  const gauges = await Promise.all(
    CATALOG_PROVIDERS.filter((p) => p.freeTier).map(async (p) => {
      const [{ limits }, usage] = await Promise.all([providerLimits(p.id), providerDailyUsage(p.id)]);
      return { id: p.id, name: p.displayName, limits, usage };
    }),
  );

  // discovery: schedule window, sources with latest scraper health
  const windowRow = await db
    .select()
    .from(schema.appMeta)
    .where(sql`${schema.appMeta.key} = 'schedule.window'`)
    .limit(1);
  const windowVal = (windowRow[0]?.value as { startHour?: number; endHour?: number } | null) ?? null;
  const scheduleWindow = { startHour: windowVal?.startHour ?? 2, endHour: windowVal?.endHour ?? 6 };
  const sourceRows = await db.select().from(schema.sources).orderBy(schema.sources.countryCode);
  const latestRuns = await db
    .select({
      sourceId: schema.discoveryRuns.sourceId,
      status: schema.discoveryRuns.status,
      fetched: schema.discoveryRuns.fetched,
      ranAt: schema.discoveryRuns.ranAt,
    })
    .from(schema.discoveryRuns)
    .orderBy(sql`${schema.discoveryRuns.ranAt} desc`)
    .limit(200);
  const latestBySource = new Map<string, { status: string; fetched: number; ranAt: Date }>();
  for (const r of latestRuns) {
    if (r.sourceId && !latestBySource.has(r.sourceId)) {
      latestBySource.set(r.sourceId, { status: r.status, fetched: r.fetched, ranAt: r.ranAt });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Admin</h1>
      <p className="text-[11.5px] text-muted">
        System functions only. Nobody sees another user&apos;s pipelines, documents, chats, or
        mail from here.
      </p>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      <Card title="Platform control">
        <div className="border-t border-line p-cardpad">
          <GlobalPauseToggle paused={paused} />
        </div>
      </Card>

      <Card title="Cost dashboard" hint={`month ${monthKey()}`}>
        <div className="border-t border-line p-cardpad">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium text-muted">Spend against cap</div>
              <div className="mt-1 font-disp text-[22px] font-extrabold tracking-[-0.02em]">
                ${spend.toFixed(2)}
                <span className="text-[13px] font-bold text-muted"> / ${capUsd}</span>
              </div>
              {spend >= capUsd && capUsd > 0 ? (
                <div className="text-[11px] text-amber">Cap reached. Free-tier models only until it rises or the month rolls over.</div>
              ) : null}
            </div>
            <CapForm currentCap={capUsd} />
          </div>
          <div className="mt-2">
            <Meter label="cap" used={Math.round(spend * 100) / 100} limit={capUsd} unit="USD" />
          </div>
        </div>
        <div className="border-t border-line p-cardpad">
          <div className="mb-1 text-[11px] font-medium text-muted">Daily spend, last 30 days</div>
          <DailyTrendChart data={daily.map((d) => ({ day: d.day, usd: Number(d.usd) }))} />
        </div>
        <div className="grid grid-cols-1 gap-0 border-t border-line md:grid-cols-3">
          {[
            { title: "Per user", rows: perUser.map((r) => ({ label: r.email ?? "system", usd: Number(r.usd), calls: Number(r.calls) })) },
            { title: "Per feature", rows: perFeature.map((r) => ({ label: r.feature, usd: Number(r.usd), calls: Number(r.calls) })) },
            { title: "Per provider", rows: perProvider.map((r) => ({ label: r.provider, usd: Number(r.usd), calls: Number(r.calls) })) },
          ].map((table) => (
            <div key={table.title} className="p-cardpad">
              <div className="mb-1.5 text-[11px] font-medium text-muted">{table.title}</div>
              {table.rows.length === 0 ? (
                <div className="text-[11.5px] text-faint">No AI calls this month.</div>
              ) : (
                table.rows
                  .sort((a, b) => b.usd - a.usd)
                  .map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between py-0.5 text-[11.5px]">
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      <span className="font-mono text-[10.5px] text-muted">
                        ${r.usd.toFixed(3)} · {r.calls}
                      </span>
                    </div>
                  ))
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-line p-cardpad">
          <div className="mb-1 text-[11px] font-medium text-muted">Free-tier gauges, today</div>
          {gauges.map((gauge) => (
            <div key={gauge.id}>
              {gauge.limits ? (
                <>
                  <Meter label={`${gauge.name} requests`} used={gauge.usage.requests} limit={gauge.limits.requests} unit="req" />
                  <Meter label={`${gauge.name} tokens`} used={gauge.usage.tokens} limit={gauge.limits.tokens} unit="tok" />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Discovery schedule">
        <div className="border-t border-line p-cardpad">
          <ScheduleWindowForm startHour={scheduleWindow.startHour} endHour={scheduleWindow.endHour} />
        </div>
      </Card>

      <Card title="Sources and scraper health" hint={`${sourceRows.length} sources`}>
        {sourceRows.map((s) => {
          const run = latestBySource.get(s.id);
          return (
            <SourceRow
              key={s.id}
              id={s.id}
              name={s.name}
              countryCode={s.countryCode}
              type={s.type}
              enabled={s.enabled}
              proxyEnabled={s.proxyEnabled}
              lastStatus={run?.status ?? null}
              lastFetched={run?.fetched ?? null}
              lastRanAt={run?.ranAt.toISOString() ?? null}
            />
          );
        })}
      </Card>

      <Card title="Users" hint={`${users.length} total`}>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold">{u.name || "No name yet"}</div>
              <div className="truncate font-mono text-[10.5px] text-faint">{u.email}</div>
            </div>
            <span
              className={`rounded-pill px-[8px] py-[2.5px] font-mono text-[10px] ${
                u.onboardedAt ? "bg-jade-dim text-jade" : "bg-track text-faint"
              }`}
            >
              {u.onboardedAt ? "onboarded" : "invited"}
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              joined {u.createdAt.toISOString().slice(0, 10)}
            </span>
          </div>
        ))}
      </Card>

      <Card title="Invites">
        <div className="border-t border-line p-cardpad">
          <InviteForm />
        </div>
        {invites.map((inv) => (
          <div key={inv.id} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
            <div className="min-w-0 flex-1 truncate text-[12.5px]">{inv.email}</div>
            <span className="font-mono text-[10.5px] text-faint">
              by {inv.inviterEmail ?? "system"}
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              expires {inv.expiresAt.toISOString().slice(0, 10)}
            </span>
          </div>
        ))}
      </Card>

      <Card
        title="Gate credential"
        hint="the shared first layer, rotating it signs everyone back through the gate"
      >
        <div className="border-t border-line p-cardpad">
          <GateRotationForm />
        </div>
      </Card>

      <Card title="Vault, platform keys" hint="write-only, values are never shown again">
        {PROVIDERS.map((p) => (
          <VaultSecretForm
            key={p}
            scope="platform"
            kind="platform_api_key"
            name={p}
            title={p}
            fields={[{ key: "value", label: "API key", type: "password" }]}
            isSet={Boolean(meta("platform_api_key", p))}
            updatedAt={meta("platform_api_key", p)?.updatedAt.toISOString() ?? null}
          />
        ))}
        <VaultSecretForm
          scope="platform"
          kind="platform_smtp"
          name="default"
          title="Platform SMTP"
          description="Sends invites and platform mail from tess@tessconsole.cloud."
          fields={[
            { key: "host", label: "Host", placeholder: "smtp.hostinger.com" },
            { key: "port", label: "Port", placeholder: "465" },
            { key: "user", label: "Username", placeholder: "tess@tessconsole.cloud" },
            { key: "pass", label: "Password", type: "password" },
            { key: "from", label: "From", placeholder: "Tess Portal <tess@tessconsole.cloud>" },
          ]}
          isSet={Boolean(meta("platform_smtp", "default"))}
          updatedAt={meta("platform_smtp", "default")?.updatedAt.toISOString() ?? null}
        />
        <VaultSecretForm
          scope="platform"
          kind="proxy"
          name="default"
          title="Rotating proxy"
          description="Used by scrapers only, per-source toggle comes with discovery."
          fields={[
            { key: "url", label: "Proxy URL", placeholder: "http://host:port" },
            { key: "user", label: "Username" },
            { key: "pass", label: "Password", type: "password" },
          ]}
          isSet={Boolean(meta("proxy", "default"))}
          updatedAt={meta("proxy", "default")?.updatedAt.toISOString() ?? null}
        />
      </Card>

      <Card
        title="Job search providers"
        hint="the discovery firehose — searches every company in your target countries"
      >
        <VaultSecretForm
          scope="platform"
          kind="platform_api_key"
          name="careerjet"
          title="Careerjet API key"
          description="Covers all 10 countries. Also declare this server's IP (185.28.22.66) in your Careerjet dashboard, or calls are rejected."
          fields={[{ key: "value", label: "API key", type: "password" }]}
          isSet={Boolean(meta("platform_api_key", "careerjet"))}
          updatedAt={meta("platform_api_key", "careerjet")?.updatedAt.toISOString() ?? null}
        />
        <VaultSecretForm
          scope="platform"
          kind="platform_api_key"
          name="adzuna"
          title="Adzuna app id + key"
          description="Adds salary data for the UK, Canada, Australia, Netherlands and New Zealand."
          fields={[
            { key: "app_id", label: "App ID" },
            { key: "app_key", label: "App key", type: "password" },
          ]}
          isSet={Boolean(meta("platform_api_key", "adzuna"))}
          updatedAt={meta("platform_api_key", "adzuna")?.updatedAt.toISOString() ?? null}
        />
        <VaultSecretForm
          scope="platform"
          kind="platform_api_key"
          name="jsearch"
          title="JSearch (RapidAPI) key"
          description="Google-for-Jobs breadth with employer names and direct apply links. Free 200 lookups/month."
          fields={[{ key: "value", label: "RapidAPI key", type: "password" }]}
          isSet={Boolean(meta("platform_api_key", "jsearch"))}
          updatedAt={meta("platform_api_key", "jsearch")?.updatedAt.toISOString() ?? null}
        />
        <VaultSecretForm
          scope="platform"
          kind="platform_api_key"
          name="jooble"
          title="Jooble API key"
          description="Adds Ireland (which Adzuna can't cover) plus more UK/NL/NZ inventory. Free key at jooble.org/api/about."
          fields={[{ key: "value", label: "API key", type: "password" }]}
          isSet={Boolean(meta("platform_api_key", "jooble"))}
          updatedAt={meta("platform_api_key", "jooble")?.updatedAt.toISOString() ?? null}
        />
        <VaultSecretForm
          scope="platform"
          kind="platform_api_key"
          name="reed"
          title="Reed API key"
          description="Deep UK job inventory that Google under-indexes. Free self-service key at reed.co.uk/developers."
          fields={[{ key: "value", label: "API key", type: "password" }]}
          isSet={Boolean(meta("platform_api_key", "reed"))}
          updatedAt={meta("platform_api_key", "reed")?.updatedAt.toISOString() ?? null}
        />
      </Card>

      <Card title="System log" hint="system-scope actions only">
        {systemLog.length === 0 ? (
          <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">
            System actions land here: invites, gate rotations, platform vault changes.
          </div>
        ) : (
          systemLog.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
              <span className="shrink-0 rounded-pill bg-jade-dim px-[8px] py-[2.5px] font-mono text-[10px] text-jade">
                {e.action}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                {e.targetId ?? ""}
              </span>
              <span className="font-mono text-[10.5px] text-faint">{e.actorEmail ?? "system"}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-faint">
                {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
            </div>
          ))
        )}
      </Card>
      </div>
    </div>
  );
}

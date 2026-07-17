import type { Metadata } from "next";
import { DateTime } from "luxon";
import { requireOnboardedUser } from "@/lib/server/auth";
import { deliverabilityStatus } from "@/lib/server/ops";
import { OpsTriggers } from "./operations-client";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

function fmt(d: string | null): string {
  if (!d) return "never";
  return DateTime.fromJSDate(new Date(d)).toFormat("d LLL yyyy, HH:mm");
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-baseline justify-between p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">{title}</h2>
        {hint ? <span className="font-mono text-[10px] text-faint">{hint}</span> : null}
      </div>
      <div className="border-t border-line p-cardpad">{children}</div>
    </div>
  );
}

function Check({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-[3px] h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: ok ? "var(--jade)" : "var(--red)" }} />
      <div className="min-w-0">
        <span className="text-[12px] font-semibold">{label}</span>{" "}
        <span className="font-mono text-[10px]" style={{ color: ok ? "var(--jade)" : "var(--red)" }}>
          {ok ? "ok" : "FAIL"}
        </span>
        <div className="truncate font-mono text-[10px] text-faint">{detail}</div>
      </div>
    </div>
  );
}

export default async function OperationsPage() {
  await requireOnboardedUser();
  const deliverability = await deliverabilityStatus();

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <div>
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Operations</h1>
        <p className="text-[11.5px] text-muted">
          Email health and the runbook. System scope: nothing here exposes any user&apos;s data.
        </p>
      </div>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      <Card title="Email deliverability" hint={deliverability ? `checked ${fmt(deliverability.checkedAt)}` : "not checked yet"}>
        {!deliverability ? (
          <p className="text-[12px] text-muted">No check has run yet. Run one below, it queries SPF, DKIM, DMARC, and MX on the sending domain.</p>
        ) : (
          <div>
            <div className="mb-1 text-[11.5px]">
              Domain <span className="font-mono text-jade">{deliverability.domain}</span>{" "}
              {deliverability.inconclusive ? (
                <span className="text-amber">check inconclusive, a DNS lookup failed transiently</span>
              ) : deliverability.healthy ? (
                <span className="text-jade">all records healthy</span>
              ) : (
                <span className="text-red">{deliverability.failures.join(", ")} failing</span>
              )}
            </div>
            <Check label="SPF" ok={deliverability.spf.ok} detail={deliverability.spf.detail} />
            <Check label="DKIM" ok={deliverability.dkim.ok} detail={deliverability.dkim.detail} />
            <Check label="DMARC" ok={deliverability.dmarc.ok} detail={deliverability.dmarc.detail} />
            <Check label="MX" ok={deliverability.mx.ok} detail={deliverability.mx.detail} />
          </div>
        )}
        <OpsTriggers />
      </Card>

      <Card title="Runbook">
        <dl className="flex flex-col gap-3 text-[12px]">
          <div>
            <dt className="font-semibold">Backups</dt>
            <dd className="text-muted">
              Backups run on the host, not in the app. A nightly cron (as the server user) dumps the database with{" "}
              <span className="font-mono text-[11px]">scripts/backup-dump.sh</span> (04:45 UTC), then{" "}
              <span className="font-mono text-[11px]">scripts/backup-offsite.sh</span> (04:55 UTC) gpg-encrypts the newest
              dump with AES256 and rclone-copies the ciphertext to Google Drive (folder TessPortalBackups). Google only ever
              receives encrypted bytes. To restore: pull the newest{" "}
              <span className="font-mono text-[11px]">.sql.gz.gpg</span>, then{" "}
              <span className="font-mono text-[11px]">gpg -d | gunzip | psql</span> into a scratch database. The gpg
              passphrase lives in the host <span className="font-mono text-[11px]">.env</span> as{" "}
              <span className="font-mono text-[11px]">BACKUP_GPG_PASSPHRASE</span> and must also be kept off the box, or the
              offsite backups cannot be decrypted after a total loss. Logs are in{" "}
              <span className="font-mono text-[11px]">logs/backup.log</span>.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Cap management</dt>
            <dd className="text-muted">
              The monthly AI spend cap, its alert threshold, and per-provider limits live in Admin. At 80 percent everyone is
              alerted; at 100 percent paid providers drop out and the free chain carries everything. Adjust the cap in Admin,
              Cost.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Gate rotation</dt>
            <dd className="text-muted">
              Rotate the universal gate credential from Admin, or from the server with{" "}
              <span className="font-mono text-[11px]">docker compose exec worker tsx apps/worker/src/cli.ts set-gate &lt;user&gt; &lt;pass&gt;</span>.
              Rotation bumps the gate version and sends everyone back to the gate screen while their user sessions stay valid.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Global pause</dt>
            <dd className="text-muted">
              The pause switch in Admin halts all agent activity and scheduled tasks platform-wide. Resume from the same
              switch. Host backups are outside the app, so they keep running regardless.
            </dd>
          </div>
        </dl>
      </Card>
      </div>
    </div>
  );
}

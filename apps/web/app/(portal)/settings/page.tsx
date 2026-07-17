import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor, type TargetCountry } from "@/lib/server/dal";
import { listSecretMeta } from "@/lib/server/vault";
import { getDb } from "@/lib/server/db";
import { schema } from "@tessportal/db";
import { ACTIVITIES, PROVIDERS } from "@/lib/ai/catalog";
import { VaultSecretForm } from "@/components/vault-secret-form";
import { ThemePicker } from "@/components/theme-toggle";
import { ModelRoutingTable, TessMemoryEditor } from "./ai-forms";
import {
  ChangePasswordForm,
  DangerZone,
  PreferencesForm,
  ProfileForm,
} from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const settings = await scope.getSettings();
  const vaultMeta = await listSecretMeta(user.id);
  const routingRows = await getDb().select().from(schema.modelRouting);
  const routing = ACTIVITIES.map((a) => {
    const row = routingRows.find((r) => r.activity === a.activity);
    return {
      activity: a.activity,
      label: a.label,
      provider: row?.provider ?? a.provider,
      model: row?.model ?? a.model,
    };
  });
  const modelOptions = PROVIDERS.flatMap((p) =>
    p.models.map((m) => ({
      provider: p.id,
      providerName: p.displayName,
      modelId: m.id,
      label: m.label,
      free: m.free,
    })),
  );
  const [instructions, facts] = await Promise.all([
    scope.listStandingInstructions(),
    scope.getLearnedProfile(),
  ]);
  const meta = (kind: string, name: string) =>
    vaultMeta.find((m) => m.kind === kind && m.name === name);

  const mailboxFields = [
    { key: "host", label: "Host", placeholder: "mail.example.com" },
    { key: "port", label: "Port", placeholder: "993" },
    { key: "user", label: "Username" },
    { key: "pass", label: "Password", type: "password" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        Settings
      </h1>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      <Card title="Profile">
        <div className="border-t border-line p-cardpad">
          <ProfileForm initialName={user.name} email={user.email} />
        </div>
      </Card>

      <Card title="Preferences">
        <div className="border-t border-line p-cardpad">
          <PreferencesForm
            initialTimezone={settings.timezone}
            initialCountries={settings.targetCountries as TargetCountry[]}
            initialRoleQuery={settings.roleQuery ?? ""}
            initialRequireSponsorship={settings.requireSponsorship ?? true}
            initialRequireFamilyReunification={settings.requireFamilyReunification ?? true}
          />
        </div>
      </Card>

      <Card title="Theme">
        <div className="border-t border-line p-cardpad">
          <p className="mb-3 text-[12.5px] text-muted">
            Dark is the default. Light uses the same system on warm paper.
          </p>
          <ThemePicker />
        </div>
      </Card>

      <Card title="Mailbox">
        <p className="px-cardpad pb-2.5 text-[11.5px] text-muted">
          Optional. With a connected mailbox, approved outreach sends from your own address and
          Tess watches replies. Without one, you get copy-ready drafts.
        </p>
        <VaultSecretForm
          scope="user"
          kind="user_smtp"
          name="default"
          title="SMTP, sending"
          description="Outgoing mail server for your outreach."
          fields={mailboxFields}
          isSet={Boolean(meta("user_smtp", "default"))}
          updatedAt={meta("user_smtp", "default")?.updatedAt.toISOString() ?? null}
        />
        <VaultSecretForm
          scope="user"
          kind="user_imap"
          name="default"
          title="IMAP, reading"
          description="Inbox monitoring for replies and interview invitations."
          fields={mailboxFields}
          isSet={Boolean(meta("user_imap", "default"))}
          updatedAt={meta("user_imap", "default")?.updatedAt.toISOString() ?? null}
        />
      </Card>

      <Card title="AI models">
        <p className="px-cardpad pb-2.5 text-[11.5px] text-muted">
          Which model runs each of Tess&apos;s activities. The free-first chain tries Cerebras,
          Groq, and Zhipu before paid providers. Routing changes apply to everyone.
        </p>
        <ModelRoutingTable routing={routing} options={modelOptions} />
      </Card>

      <Card title="Tess memory">
        <div className="border-t border-line p-cardpad">
          <TessMemoryEditor
            instructions={instructions.map((i) => ({ id: i.id, instruction: i.instruction }))}
            facts={facts}
          />
        </div>
      </Card>

      <Card title="Security">
        <div className="border-t border-line p-cardpad">
          <ChangePasswordForm />
        </div>
      </Card>

      <Card title="Your data">
        <div className="border-t border-line p-cardpad">
          <DangerZone />
        </div>
      </Card>
      </div>
    </div>
  );
}

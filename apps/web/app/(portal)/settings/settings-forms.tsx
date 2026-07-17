"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Country = { code: string | null; name: string };

const SUPPORTED: { code: string; name: string }[] = [
  { code: "IE", name: "Ireland" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NO", name: "Norway" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "QA", name: "Qatar" },
  { code: "SA", name: "Saudi Arabia" },
];

function useSave() {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "busy" | "saved" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  async function save(body: Record<string, unknown>, endpoint = "/api/settings", method = "PATCH") {
    setState("busy");
    setMessage(null);
    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setState("error");
      setMessage(payload.error ?? "could not save, try again");
      return false;
    }
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 2000);
    return true;
  }
  return { state, message, save };
}

export function ProfileForm({ initialName, email }: { initialName: string; email: string }) {
  const [name, setName] = React.useState(initialName);
  const { state, message, save } = useSave();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="pf-email">Email</Label>
        <Input id="pf-email" value={email} disabled />
      </div>
      <div>
        <Label htmlFor="pf-name">Name</Label>
        <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {message ? <p className="text-[11.5px] text-red">{message}</p> : null}
      <div>
        <Button onClick={() => save({ name })} disabled={state === "busy" || !name.trim()}>
          {state === "saved" ? "Saved" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}

export function PreferencesForm({
  initialTimezone,
  initialCountries,
  initialRoleQuery,
  initialRequireSponsorship,
  initialRequireFamilyReunification,
}: {
  initialTimezone: string;
  initialCountries: Country[];
  initialRoleQuery: string;
  initialRequireSponsorship: boolean;
  initialRequireFamilyReunification: boolean;
}) {
  const [timezone, setTimezone] = React.useState(initialTimezone);
  const [countries, setCountries] = React.useState<Country[]>(initialCountries);
  const [manualEntry, setManualEntry] = React.useState("");
  const [titles, setTitles] = React.useState<string[]>(() =>
    initialRoleQuery.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
  );
  const [titleInput, setTitleInput] = React.useState("");
  const [requireSponsorship, setRequireSponsorship] = React.useState(initialRequireSponsorship);
  const [requireFamily, setRequireFamily] = React.useState(initialRequireFamilyReunification);
  const { state, message, save } = useSave();

  const timezones = React.useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);

  function addTitle() {
    const t = titleInput.trim();
    if (!t) return;
    setTitles((list) =>
      list.some((x) => x.toLowerCase() === t.toLowerCase()) ? list : [...list, t].slice(0, 12),
    );
    setTitleInput("");
  }
  function removeTitle(t: string) {
    setTitles((list) => list.filter((x) => x !== t));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="pref-role">What roles are you looking for?</Label>
        <div className="flex gap-2">
          <Input
            id="pref-role"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTitle();
              }
            }}
            placeholder="e.g. Full Stack Developer"
          />
          <Button type="button" variant="secondary" onClick={addTitle} disabled={!titleInput.trim()}>
            Add
          </Button>
        </div>
        {titles.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {titles.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 rounded-pill border border-line bg-bg px-2.5 py-[3px] text-[11px] text-fg"
              >
                {t}
                <button type="button" onClick={() => removeTitle(t)} className="text-faint hover:text-red" aria-label={`remove ${t}`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-1.5 text-[10.5px] text-faint">
          Add each job title you want Tess to search — press Enter or Add. Tess runs every title
          across all your target countries, so no single title dominates. These take priority; if
          you leave the list empty, Tess falls back to your résumé headline only — and if there is no
          headline either, it pauses the search rather than guess at roles you don’t need.
        </p>
      </div>
      <div>
        <Label>Target countries</Label>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED.map((c) => {
            const on = countries.some((x) => x.code === c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() =>
                  setCountries((cur) =>
                    on ? cur.filter((x) => x.code !== c.code) : [...cur, c],
                  )
                }
                className={cn(
                  "rounded-pill border px-[10px] py-[4px] text-[11px] font-medium",
                  on
                    ? "border-jade-line bg-jade-dim text-jade"
                    : "border-line text-muted hover:bg-raised",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10.5px] text-faint">
          These countries get automated discovery. Others below work in manual mode.
        </p>
      </div>
      <div>
        <Label htmlFor="pref-manual">Manual mode countries</Label>
        <div className="flex gap-2">
          <Input
            id="pref-manual"
            value={manualEntry}
            onChange={(e) => setManualEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = manualEntry.trim();
                if (v && !countries.some((x) => x.name.toLowerCase() === v.toLowerCase())) {
                  setCountries((cur) => [...cur, { code: null, name: v }]);
                }
                setManualEntry("");
              }
            }}
            placeholder="Germany"
          />
        </div>
        {countries.some((c) => c.code === null) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {countries
              .filter((c) => c.code === null)
              .map((c) => (
                <button
                  key={c.name}
                  type="button"
                  title="Remove"
                  onClick={() => setCountries((cur) => cur.filter((x) => x.name !== c.name))}
                  className="rounded-pill border border-line bg-raised px-[10px] py-[4px] text-[11px] text-muted"
                >
                  {c.name} ×
                </button>
              ))}
          </div>
        ) : null}
      </div>
      <ToggleRow
        label="Only show jobs with visa sponsorship"
        hint="Hides roles with no sponsorship signal in countries that publish a sponsor register. Gulf and register-less countries are always kept."
        checked={requireSponsorship}
        onChange={setRequireSponsorship}
      />
      <ToggleRow
        label="Prioritise family-reunification countries"
        hint="Ranks countries that let you bring your spouse and children above the rest."
        checked={requireFamily}
        onChange={setRequireFamily}
      />
      <div>
        <Label htmlFor="pref-tz">Timezone</Label>
        <select
          id="pref-tz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      {message ? <p className="text-[11.5px] text-red">{message}</p> : null}
      <div>
        <Button
          onClick={() =>
            save({
              timezone,
              targetCountries: countries,
              roleQuery: titles.join(", ") || null,
              requireSponsorship,
              requireFamilyReunification: requireFamily,
            })
          }
          disabled={state === "busy"}
        >
          {state === "saved" ? "Saved" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <div className="text-[12.5px] font-semibold">{label}</div>
        <div className="text-[10.5px] text-faint">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full border transition-colors",
          checked ? "border-jade-line bg-jade-dim" : "border-line bg-bg",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[16px] w-[16px] rounded-full transition-all",
            checked ? "left-[18px] bg-jade" : "left-[2px] bg-muted",
          )}
        />
      </button>
    </div>
  );
}

export function ChangePasswordForm() {
  const { state, message, save } = useSave();
  const [fields, setFields] = React.useState({ current: "", next: "", confirm: "" });
  const mismatch = fields.confirm.length > 0 && fields.next !== fields.confirm;

  return (
    <div className="flex max-w-[360px] flex-col gap-3">
      <div>
        <Label htmlFor="cp-current">Current password</Label>
        <Input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          value={fields.current}
          onChange={(e) => setFields((f) => ({ ...f, current: e.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="cp-next">New password</Label>
        <Input
          id="cp-next"
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={fields.next}
          onChange={(e) => setFields((f) => ({ ...f, next: e.target.value }))}
        />
        <p className="mt-1 text-[10.5px] text-faint">
          At least 10 characters. Changing it signs out your other sessions.
        </p>
      </div>
      <div>
        <Label htmlFor="cp-confirm">New password again</Label>
        <Input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          value={fields.confirm}
          onChange={(e) => setFields((f) => ({ ...f, confirm: e.target.value }))}
        />
        {mismatch ? <p className="mt-1 text-[11.5px] text-red">The passwords do not match.</p> : null}
      </div>
      {message ? <p className="text-[11.5px] text-red">{message}</p> : null}
      <div>
        <Button
          onClick={async () => {
            const ok = await save(
              { current: fields.current, next: fields.next },
              "/api/auth/change-password",
              "POST",
            );
            if (ok) setFields({ current: "", next: "", confirm: "" });
          }}
          disabled={
            state === "busy" || mismatch || !fields.current || fields.next.length < 10
          }
        >
          {state === "saved" ? "Changed" : "Change password"}
        </Button>
      </div>
    </div>
  );
}

export function DangerZone() {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "could not delete, try again");
      setBusy(false);
      return;
    }
    router.push("/gate");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold">Export your data</div>
          <div className="text-[11px] text-muted">
            A complete archive of everything Tess Portal holds about you, as JSON. Vault values
            stay out, they are write-only.
          </div>
        </div>
        <a href="/api/account/export" download>
          <Button variant="secondary">Download export</Button>
        </a>
      </div>
      <div className="h-px bg-line" />
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold">Delete your account</div>
          <div className="text-[11px] text-muted">
            Removes your account and every row of your data. There is no undo.
          </div>
        </div>
        {!confirming ? (
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-bg p-3">
          <Label htmlFor="del-password">Enter your password to confirm</Label>
          <Input
            id="del-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
          <div className="flex gap-2">
            <Button variant="destructive" onClick={deleteAccount} disabled={busy || !password}>
              Delete everything
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CvUploadFlow } from "@/components/cv-flow";
import { cn } from "@/lib/utils";

type Country = { code: string | null; name: string };

/** Countries with automated discovery at launch. */
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

const STEPS = ["Your name", "Preferences", "Your CV", "Done"] as const;

export function OnboardingWizard(props: {
  initialName: string;
  initialTimezone: string;
  initialCountries: Country[];
  initialTheme: "dark" | "light";
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState(props.initialName);
  const [timezone, setTimezone] = React.useState(
    props.initialTimezone !== "UTC"
      ? props.initialTimezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [countries, setCountries] = React.useState<Country[]>(props.initialCountries);
  const [manualEntry, setManualEntry] = React.useState("");
  const [roleQuery, setRoleQuery] = React.useState("");
  const [theme, setTheme] = React.useState<"dark" | "light">(props.initialTheme);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const timezones = React.useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);

  function toggleSupported(c: { code: string; name: string }) {
    setCountries((cur) =>
      cur.some((x) => x.code === c.code)
        ? cur.filter((x) => x.code !== c.code)
        : [...cur, c],
    );
  }

  function addManual() {
    const nameTrimmed = manualEntry.trim();
    if (!nameTrimmed) return;
    setCountries((cur) =>
      cur.some((x) => x.name.toLowerCase() === nameTrimmed.toLowerCase())
        ? cur
        : [...cur, { code: null, name: nameTrimmed }],
    );
    setManualEntry("");
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          timezone,
          targetCountries: countries,
          roleQuery: roleQuery.trim() || null,
          theme,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "something went wrong, try again");
        setBusy(false);
        return;
      }
      if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      try {
        localStorage.setItem("tessportal-theme", theme);
      } catch {}
      router.push("/pipeline");
      router.refresh();
    } catch {
      setError("could not reach the server, try again");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 ? <span className="h-px flex-1 bg-line" /> : null}
            <span
              className={cn(
                "font-mono text-[10px]",
                i === step ? "text-jade" : i < step ? "text-muted" : "text-faint",
              )}
            >
              {i + 1} {label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {step === 0 ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <h1 className="font-disp text-[15px] font-bold">Welcome</h1>
            <p className="mt-1 text-[11.5px] text-muted">
              Tess runs your job search here. A few quick things first.
            </p>
          </div>
          <div>
            <Label htmlFor="name">What should Tess call you?</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <Button onClick={() => setStep(1)} disabled={!name.trim()}>
            Next
          </Button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <h1 className="font-disp text-[15px] font-bold">Where are you looking?</h1>
            <p className="mt-1 text-[11.5px] text-muted">
              These countries get automated discovery. Any other country works in manual mode:
              paste in jobs, track, tailor, and reach out.
            </p>
          </div>
          <div>
            <Label htmlFor="role">What roles are you looking for?</Label>
            <Input
              id="role"
              value={roleQuery}
              onChange={(e) => setRoleQuery(e.target.value)}
              placeholder="e.g. Full Stack Developer, Software Engineer"
            />
            <p className="mt-1 text-[10.5px] text-faint">
              Add one or more job titles, separated by commas — Tess searches each one. You can add
              or change these anytime in Settings.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED.map((c) => {
              const on = countries.some((x) => x.code === c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleSupported(c)}
                  className={cn(
                    "rounded-pill border px-[10px] py-[4px] text-[11px] font-medium",
                    on
                      ? "border-jade-line bg-jade-dim text-jade"
                      : "border-line bg-transparent text-muted hover:bg-raised",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          <div>
            <Label htmlFor="manual">Add another country, manual mode</Label>
            <div className="flex gap-2">
              <Input
                id="manual"
                value={manualEntry}
                onChange={(e) => setManualEntry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
                placeholder="Germany"
              />
              <Button type="button" variant="secondary" onClick={addManual}>
                Add
              </Button>
            </div>
            {countries.some((c) => c.code === null) ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {countries
                  .filter((c) => c.code === null)
                  .map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() =>
                        setCountries((cur) => cur.filter((x) => x.name !== c.name))
                      }
                      className="rounded-pill border border-line bg-raised px-[10px] py-[4px] text-[11px] text-muted"
                      title="Remove"
                    >
                      {c.name} ×
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="tz">Your timezone</Label>
            <select
              id="tz"
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
          <div>
            <Label>Theme</Label>
            <div className="flex gap-2">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={cn(
                    "rounded-btn border px-[13px] py-[6px] text-[11.5px] font-semibold capitalize",
                    theme === t
                      ? "border-jade-line bg-jade-dim text-jade"
                      : "border-line text-muted hover:bg-raised",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)} disabled={countries.length === 0}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <h1 className="font-disp text-[15px] font-bold">Your CV</h1>
            <p className="mt-1 text-[11.5px] text-muted">
              Upload your CV and Tess parses it into a profile. Review and confirm it, that is the
              one source of truth for everything she tailors. You can also do this later in
              Documents.
            </p>
          </div>
          <CvUploadFlow />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Next</Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-3.5">
          <div>
            <h1 className="font-disp text-[15px] font-bold">You are set, {name.trim()}</h1>
            <p className="mt-1 text-[11.5px] text-muted">
              Your pipeline is ready. Here is what Tess can do from here.
            </p>
          </div>
          <ul className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-cardpad text-[12px] text-muted">
            {[
              "Discover roles matched to your target countries, with sponsorship flagged",
              "Tailor a CV and cover letter to any job, using only what your profile backs",
              "Research a company into a sourced brief and prep you for interviews",
              "Draft outreach and send it from your own mailbox, only after you approve",
              "Chat with her about any of it, she already knows your pipeline",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-jade" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint">
            Tip: open Chat and just tell Tess what you are looking for. She takes it from there.
          </p>
          {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={finish} disabled={busy}>
              {busy ? "Working" : "Open Tess Portal"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

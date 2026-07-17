"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function NewJobForm() {
  const router = useRouter();
  const [mode, setMode] = React.useState<"manual" | "paste">("manual");
  const [pasteText, setPasteText] = React.useState("");
  const [parsing, setParsing] = React.useState(false);
  const [parsedNote, setParsedNote] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState({
    title: "",
    companyName: "",
    location: "",
    url: "",
    salaryRaw: "",
    description: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function set(key: keyof typeof fields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function parse() {
    setParsing(true);
    setParsedNote(null);
    const res = await fetch("/api/jobs/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pasteText }),
    });
    setParsing(false);
    if (!res.ok) {
      setError("could not parse that, fill the fields yourself");
      return;
    }
    const { parsed } = (await res.json()) as {
      parsed: {
        title: string;
        companyName: string;
        location: string;
        url: string;
        salaryRaw: string;
        description: string;
      };
    };
    setFields({
      title: parsed.title,
      companyName: parsed.companyName,
      location: parsed.location,
      url: parsed.url,
      salaryRaw: parsed.salaryRaw,
      description: parsed.description,
    });
    setParsedNote(
      "Prefilled with basic extraction. Check every field. Smarter parsing arrives with Tess in a later phase.",
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: fields.title,
        companyName: fields.companyName,
        location: fields.location || undefined,
        url: fields.url || "",
        salaryRaw: fields.salaryRaw || undefined,
        description: fields.description || undefined,
        source: mode,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
    if (!res.ok || !payload.id) {
      setError(payload.error ?? "could not save the job, try again");
      setBusy(false);
      return;
    }
    router.push(`/pipeline/${payload.id}`);
    router.refresh();
  }

  return (
    <div className="rounded-card border border-line bg-surface p-cardpad">
      <div className="mb-4 flex gap-2">
        {(
          [
            ["manual", "Enter by hand"],
            ["paste", "Paste a posting"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-btn border px-[13px] py-[6px] text-[11.5px] font-semibold",
              mode === m
                ? "border-jade-line bg-jade-dim text-jade"
                : "border-line text-muted hover:bg-raised",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="paste">Paste the full posting text</Label>
          <textarea
            id="paste"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg placeholder:text-faint"
            placeholder="Copy the whole job posting and paste it here."
          />
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={parse}
              disabled={parsing || pasteText.trim().length < 20}
            >
              {parsing ? "Parsing" : "Parse into the form"}
            </Button>
          </div>
          {parsedNote ? <p className="text-[11px] text-amber">{parsedNote}</p> : null}
        </div>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="j-title">Job title</Label>
            <Input id="j-title" value={fields.title} onChange={set("title")} required />
          </div>
          <div>
            <Label htmlFor="j-company">Company</Label>
            <Input id="j-company" value={fields.companyName} onChange={set("companyName")} required />
          </div>
          <div>
            <Label htmlFor="j-location">Location</Label>
            <Input id="j-location" value={fields.location} onChange={set("location")} placeholder="Dublin, IE" />
          </div>
          <div>
            <Label htmlFor="j-salary">Salary, as posted</Label>
            <Input id="j-salary" value={fields.salaryRaw} onChange={set("salaryRaw")} placeholder="€65k + bonus" />
          </div>
        </div>
        <div>
          <Label htmlFor="j-url">Posting URL</Label>
          <Input id="j-url" type="url" value={fields.url} onChange={set("url")} placeholder="https://" />
        </div>
        <div>
          <Label htmlFor="j-desc">Description</Label>
          <textarea
            id="j-desc"
            value={fields.description}
            onChange={set("description")}
            rows={6}
            className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
          />
          <p className="mt-1 text-[10.5px] text-faint">
            Saved jobs keep a permanent snapshot of what you enter here, even if the posting
            disappears.
          </p>
        </div>
        {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
        <div>
          <Button type="submit" disabled={busy || !fields.title.trim() || !fields.companyName.trim()}>
            {busy ? "Saving" : "Save to pipeline"}
          </Button>
        </div>
      </form>
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Write-only vault entry editor. Shows whether a value is set and when
 * it changed, accepts a new value, and can delete. It never displays
 * the stored value, there is no read path to display it with.
 */
export function VaultSecretForm({
  scope,
  kind,
  name,
  title,
  description,
  fields,
  isSet,
  updatedAt,
}: {
  scope: "platform" | "user";
  kind: string;
  name: string;
  title: string;
  description?: string;
  /** one text field per key; a single field named "value" stores the raw string */
  fields: { key: string; label: string; type?: string; placeholder?: string }[];
  isSet: boolean;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/vault/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, kind, name }),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      setTestResult({
        ok: Boolean(payload.ok),
        message: payload.message ?? payload.error ?? "the test did not answer, try again",
      });
    } catch {
      setTestResult({ ok: false, message: "could not reach the server, try again" });
    }
    setTesting(false);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
      string,
      string
    >;
    const value =
      fields.length === 1 && fields[0].key === "value" ? data.value : JSON.stringify(data);
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, kind, name, value }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "could not save, try again");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    await fetch("/api/vault", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, kind, name }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="border-t border-line px-cardpad py-rowpad">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold">{title}</div>
          {description ? <div className="text-[11px] text-muted">{description}</div> : null}
        </div>
        <span
          className={`rounded-pill px-[8px] py-[2.5px] font-mono text-[10px] ${
            isSet ? "bg-jade-dim text-jade" : "bg-track text-faint"
          }`}
        >
          {isSet ? `set ${updatedAt ? updatedAt.slice(0, 10) : ""}` : "not set"}
        </span>
        {isSet ? (
          <Button variant="secondary" onClick={runTest} disabled={testing}>
            {testing ? "Testing" : "Test"}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
          {isSet ? "Replace" : "Set"}
        </Button>
        {isSet ? (
          <Button variant="destructive" onClick={remove} disabled={busy}>
            Delete
          </Button>
        ) : null}
      </div>
      {testResult ? (
        <p className={`mt-2 text-[11.5px] ${testResult.ok ? "text-jade" : "text-red"}`}>
          {testResult.message}
        </p>
      ) : null}
      {open ? (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2.5 rounded-[10px] bg-bg p-3">
          {fields.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`${kind}-${name}-${f.key}`}>{f.label}</Label>
              <Input
                id={`${kind}-${name}-${f.key}`}
                name={f.key}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                autoComplete="off"
                required
              />
            </div>
          ))}
          {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Save to vault
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[10.5px] text-faint">
            Stored encrypted. You can replace or delete it later, but never read it back.
          </p>
        </form>
      ) : null}
    </div>
  );
}

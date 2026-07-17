"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ link: string; emailed: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      link?: string;
      emailed?: boolean;
    };
    setBusy(false);
    if (!res.ok || !payload.link) {
      setError(payload.error ?? "could not create the invite, try again");
      return;
    }
    setResult({ link: payload.link, emailed: Boolean(payload.emailed) });
    setEmail("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          required
        />
        <Button type="submit" disabled={busy || !email}>
          Send invite
        </Button>
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      {result ? (
        <div className="rounded-[10px] bg-bg p-3">
          <p className="text-[11.5px] text-muted">
            {result.emailed
              ? "Invite emailed. The link below works too, it is shown only this once."
              : "Email is not configured yet, so nothing was sent. Copy this link and share it yourself, it is shown only this once."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[7px] border border-line bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-fg">
              {result.link}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(result.link)}
            >
              Copy
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function GateRotationForm() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/admin/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not rotate, try again");
      return;
    }
    setDone(true);
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex max-w-[360px] flex-col gap-2.5">
      <div>
        <Label htmlFor="gate-username">New access username</Label>
        <Input id="gate-username" name="username" autoComplete="off" required minLength={3} />
      </div>
      <div>
        <Label htmlFor="gate-password">New access password</Label>
        <Input
          id="gate-password"
          name="password"
          type="password"
          autoComplete="off"
          required
          minLength={10}
        />
        <p className="mt-1 text-[10.5px] text-faint">
          Everyone re-enters the gate on their next request. Their own sign in stays valid.
        </p>
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      {done ? <p className="text-[11.5px] text-jade">Rotated. Share the new credential.</p> : null}
      <div>
        <Button type="submit" disabled={busy}>
          Rotate gate credential
        </Button>
      </div>
    </form>
  );
}

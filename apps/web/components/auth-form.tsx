"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Small client-side form runner for the auth flows: posts JSON to an
 * API route, shows the API's error message plainly, redirects on
 * success.
 */
export function AuthForm({
  endpoint,
  submitLabel,
  successHref,
  children,
  transform,
  onSuccess,
}: {
  endpoint: string;
  submitLabel: string;
  successHref?: string;
  children: React.ReactNode;
  /** return null to abort the submit (client-side validation) */
  transform?: (data: Record<string, string>) => Record<string, unknown> | null;
  onSuccess?: (payload: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const data = Object.fromEntries(
      new FormData(e.currentTarget).entries(),
    ) as Record<string, string>;
    const body = transform ? transform(data) : data;
    if (body === null) {
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof payload.error === "string" ? payload.error : "something went wrong, try again");
        setBusy(false);
        return;
      }
      if (onSuccess) {
        onSuccess(payload);
      } else if (successHref) {
        router.push(successHref);
        router.refresh();
      }
    } catch {
      setError("could not reach the server, try again");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      {children}
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Working" : submitLabel}
      </Button>
    </form>
  );
}

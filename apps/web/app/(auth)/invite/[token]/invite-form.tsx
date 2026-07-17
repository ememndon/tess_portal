"use client";

import * as React from "react";
import { AuthForm } from "@/components/auth-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteForm({ token }: { token: string }) {
  const [mismatch, setMismatch] = React.useState(false);
  return (
    <AuthForm
      endpoint="/api/auth/accept-invite"
      submitLabel="Create account"
      successHref="/onboarding"
      transform={(data) => {
        if (data.password !== data.confirm) {
          setMismatch(true);
          return null;
        }
        setMismatch(false);
        return { token, name: data.name, password: data.password };
      }}
    >
      <div>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <p className="mt-1 text-[10.5px] text-faint">At least 10 characters.</p>
      </div>
      <div>
        <Label htmlFor="confirm">Password again</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        {mismatch ? <p className="mt-1 text-[11.5px] text-red">The passwords do not match.</p> : null}
      </div>
    </AuthForm>
  );
}

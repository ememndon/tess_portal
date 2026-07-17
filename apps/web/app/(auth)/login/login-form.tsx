"use client";

import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  return (
    <AuthForm
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      onSuccess={(payload) => {
        router.push(payload.onboarded ? "/pipeline" : "/onboarding");
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
    </AuthForm>
  );
}

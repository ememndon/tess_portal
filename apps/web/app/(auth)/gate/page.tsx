import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Access" };

/** Only same-site relative paths may be used as a post-gate destination. */
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/login";
}

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h1 className="font-disp text-[15px] font-bold">Shared access</h1>
      <p className="mb-4 mt-1 text-[11.5px] text-muted">
        Enter the shared credential first. Your own sign in comes next.
      </p>
      <AuthForm
        endpoint="/api/auth/gate"
        submitLabel="Continue"
        successHref={safeNext(next)}
      >
        <div>
          <Label htmlFor="username">Access username</Label>
          <Input id="username" name="username" autoComplete="off" required autoFocus />
        </div>
        <div>
          <Label htmlFor="password">Access password</Label>
          <Input id="password" name="password" type="password" autoComplete="off" required />
        </div>
      </AuthForm>
    </div>
  );
}

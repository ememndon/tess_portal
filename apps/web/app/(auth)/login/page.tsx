import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { gatePassed, getSessionUser } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await gatePassed())) redirect("/gate");
  const user = await getSessionUser();
  if (user) redirect(user.onboardedAt ? "/pipeline" : "/onboarding");

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h1 className="font-disp text-[15px] font-bold">Sign in</h1>
      <p className="mb-4 mt-1 text-[11.5px] text-muted">Your own email and password.</p>
      <LoginForm />
    </div>
  );
}

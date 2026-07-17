import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { scopeFor, type TargetCountry } from "@/lib/server/dal";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboardedAt) redirect("/pipeline");
  const settings = await scopeFor(user.id).getSettings();

  return (
    <OnboardingWizard
      initialName={user.name}
      initialTimezone={settings.timezone}
      initialCountries={settings.targetCountries as TargetCountry[]}
      initialTheme={settings.theme === "light" ? "light" : "dark"}
    />
  );
}

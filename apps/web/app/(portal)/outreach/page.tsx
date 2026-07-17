import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { OutreachClient } from "./outreach-client";

export const metadata: Metadata = { title: "Outreach" };
export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const [contacts, jobs, sequences, experiments, clicks] = await Promise.all([
    scope.listContacts(),
    scope.listJobs(),
    scope.listSequences(),
    scope.experimentSummary(),
    scope.listLinkClicks(),
  ]);

  return (
    <OutreachClient
      contacts={contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, companyName: c.companyName, email: c.email, linkedin: c.linkedin }))}
      jobs={jobs.map((j) => ({ id: j.id, label: `${j.title}, ${j.companyName}` }))}
      sequences={sequences.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        steps: s.steps.map((st) => ({ position: st.position, kind: st.kind, status: st.status, dueAt: st.dueAt?.toISOString() ?? null })),
      }))}
      experiments={experiments}
      clicks={clicks.map((c) => ({ url: c.url, clickCount: c.clickCount, clickedAt: c.clickedAt?.toISOString() ?? null }))}
    />
  );
}

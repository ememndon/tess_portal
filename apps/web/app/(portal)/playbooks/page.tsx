import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { listPlaybooks, seedBuiltinPlaybooks, type StepLogEntry } from "@/lib/server/playbooks";
import { PlaybooksClient } from "./playbooks-client";

export const metadata: Metadata = { title: "Playbooks" };
export const dynamic = "force-dynamic";

export default async function PlaybooksPage() {
  const user = await requireOnboardedUser();
  await seedBuiltinPlaybooks(user.id);
  const playbooks = await listPlaybooks(user.id);

  return (
    <PlaybooksClient
      playbooks={playbooks.map((p) => ({
        id: p.id,
        title: p.title,
        trigger: p.trigger,
        category: p.category,
        builtin: p.builtin,
        steps: p.steps.map((s) => ({ instruction: s.instruction, mode: s.mode as "auto" | "ask_first" })),
        runs: p.runs.map((r) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          stepLog: (r.stepLog as StepLogEntry[]) ?? [],
        })),
      }))}
    />
  );
}

import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "Add a job" };
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  await requireOnboardedUser();
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-gap">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        Add a job
      </h1>
      <NewJobForm />
    </div>
  );
}

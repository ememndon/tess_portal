import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { listPendingApprovals } from "@/lib/server/approvals";
import { ApprovalCard } from "@/components/approval-card";
import { Button } from "@/components/ui/button";
import { PipelineBoard, type BoardJob } from "./board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const user = await requireOnboardedUser();
  const jobs = await scopeFor(user.id).listJobs();
  const pendingApprovals = await listPendingApprovals(user.id);

  const boardJobs: BoardJob[] = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    companyName: j.companyName,
    location: j.location,
    salaryRaw: j.salaryRaw,
    stage: j.stage,
    matchScore: j.matchScore,
  }));

  return (
    <div className="flex h-full flex-col gap-gap">
      <div className="flex items-center">
        <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
          Pipeline
        </h1>
        <span className="ml-3 font-mono text-[10.5px] text-faint">{jobs.length} jobs</span>
        <div className="ml-auto">
          <Link href="/pipeline/new">
            <Button>Add a job</Button>
          </Link>
        </div>
      </div>

      {pendingApprovals.length > 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">Waiting for your approval</h2>
            <span className="ml-2 font-mono text-[10px] text-amber">{pendingApprovals.length}</span>
          </div>
          <div className="flex flex-col gap-2 border-t border-line p-cardpad">
            {pendingApprovals.map((a) => (
              <ApprovalCard
                key={a.id}
                approvalId={a.id}
                title={a.title}
                summary={a.summary}
                detail={JSON.stringify(a.payload, null, 2)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-cardpad py-10">
          <p className="max-w-[52ch] text-center text-[12.5px] text-muted">
            Jobs you are working on move through eight stages here, from Saved to Offer. Add one
            by hand or paste a posting.
          </p>
          <Link href="/pipeline/new">
            <Button>Add a job</Button>
          </Link>
        </div>
      ) : (
        <PipelineBoard initialJobs={boardJobs} />
      )}
    </div>
  );
}

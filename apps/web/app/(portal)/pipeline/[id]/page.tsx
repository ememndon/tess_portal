import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { ScoreRing } from "@/components/score-ring";
import { StagePill } from "@/components/stage-pill";
import { JobActions, NoteComposer } from "./job-client";
import { PrepareApplication } from "./prepare-client";

export const metadata: Metadata = { title: "Job" };
export const dynamic = "force-dynamic";

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Saved to pipeline",
  stage_changed: "Stage changed",
  note: "Note",
  edited: "Details edited",
  interview_scheduled: "Interview scheduled",
  offer_recorded: "Offer recorded",
  document_linked: "Document version linked",
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const { id } = await params;
  const job = await scope.getJob(id);
  if (!job) notFound();
  const [activities, snapshot, linkedVersions, allInterviews, masterProfile] = await Promise.all([
    scope.listJobActivities(job.id),
    scope.getJobSnapshot(job.id),
    scope.listVersionsForJob(job.id),
    scope.listInterviews(),
    scope.getMasterProfile(),
  ]);
  const jobInterviews = allInterviews.filter((i) => i.interview.jobId === job.id);
  const profileConfirmed = Boolean(masterProfile?.confirmedAt);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-gap">
      <div className="flex items-start gap-3.5">
        {job.matchScore !== null ? <ScoreRing score={job.matchScore} size={48} /> : null}
        <div className="min-w-0 flex-1">
          <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
            {job.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span>{[job.companyName, job.location, job.salaryRaw].filter(Boolean).join(" · ")}</span>
            <StagePill stage={job.stage} />
            {job.url ? (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-jade"
              >
                Open posting
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <JobActions jobId={job.id} currentStage={job.stage} />

      <PrepareApplication jobId={job.id} profileConfirmed={profileConfirmed} currentStage={job.stage} />

      <div className="grid grid-cols-1 gap-gap @3xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-gap">
          <div className="rounded-card border border-line bg-surface">
            <div className="flex items-center p-cardpad pb-2.5">
              <h2 className="font-disp text-[13.5px] font-bold">Activity</h2>
            </div>
            <div className="border-t border-line p-cardpad">
              <NoteComposer jobId={job.id} />
            </div>
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3 border-t border-line px-cardpad py-rowpad">
                <span className="mt-[2px] shrink-0 rounded-pill bg-jade-dim px-[8px] py-[2.5px] font-mono text-[10px] text-jade">
                  {ACTIVITY_LABELS[a.type] ?? a.type}
                </span>
                <div className="min-w-0 flex-1 text-[12px] text-muted">
                  {a.type === "note"
                    ? (a.payload as { note?: string })?.note
                    : a.type === "stage_changed"
                      ? `${(a.payload as { from?: string })?.from} to ${(a.payload as { to?: string })?.to}`
                      : ""}
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-faint">
                  {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </div>
            ))}
          </div>

          {job.description ? (
            <div className="rounded-card border border-line bg-surface">
              <div className="flex items-center p-cardpad pb-2.5">
                <h2 className="font-disp text-[13.5px] font-bold">Description</h2>
                {snapshot ? (
                  <span className="ml-auto font-mono text-[10px] text-faint">
                    snapshot {snapshot.capturedAt.toISOString().slice(0, 10)}
                  </span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap border-t border-line p-cardpad text-[12px] leading-relaxed text-muted">
                {job.description}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-gap">
          <div className="rounded-card border border-line bg-surface">
            <div className="flex items-center p-cardpad pb-2.5">
              <h2 className="font-disp text-[13.5px] font-bold">Interviews</h2>
              <Link href="/interviews" className="ml-auto text-[11.5px] font-semibold text-jade">
                All
              </Link>
            </div>
            {jobInterviews.length === 0 ? (
              <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">
                None yet. Schedule one from Interviews &amp; Offers.
              </div>
            ) : (
              jobInterviews.map(({ interview }) => (
                <div key={interview.id} className="border-t border-line px-cardpad py-rowpad">
                  <div className="text-[12.5px] font-semibold">{interview.round}</div>
                  <div className="font-mono text-[10.5px] text-faint">
                    {interview.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·{" "}
                    {interview.medium}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-card border border-line bg-surface">
            <div className="flex items-center p-cardpad pb-2.5">
              <h2 className="font-disp text-[13.5px] font-bold">Documents sent</h2>
              <Link href="/documents" className="ml-auto text-[11.5px] font-semibold text-jade">
                Documents
              </Link>
            </div>
            {linkedVersions.length === 0 ? (
              <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">
                No versions linked to this job yet.
              </div>
            ) : (
              linkedVersions.map((v) => (
                <div key={v.id} className="flex items-center gap-2 border-t border-line px-cardpad py-rowpad">
                  <span className="min-w-0 flex-1 truncate text-[12px]">{v.fileName}</span>
                  <span className="font-mono text-[10px] text-faint">v{v.version}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

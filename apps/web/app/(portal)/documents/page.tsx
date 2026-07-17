import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import { profileSchema, type Profile } from "@/lib/cv/schema";
import { CvUploadFlow } from "@/components/cv-flow";
import { DocumentList, UploadForm } from "./documents-client";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const [docs, jobs, masterProfile] = await Promise.all([
    scope.listDocuments(),
    scope.listJobs(),
    scope.getMasterProfile(),
  ]);
  const profile: Profile | null = masterProfile ? profileSchema.parse(masterProfile.data ?? {}) : null;
  const confirmed = Boolean(masterProfile?.confirmedAt);

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        Documents
      </h1>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center p-cardpad pb-2.5">
          <h2 className="font-disp text-[13.5px] font-bold">Your profile</h2>
          {confirmed ? (
            <span className="ml-2 rounded-pill bg-jade-dim px-[8px] py-[2.5px] font-mono text-[10px] text-jade">confirmed</span>
          ) : (
            <span className="ml-2 rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-amber">not confirmed</span>
          )}
        </div>
        <div className="border-t border-line p-cardpad">
          <CvUploadFlow existingProfile={profile} confirmed={confirmed} />
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center p-cardpad pb-2.5">
          <h2 className="font-disp text-[13.5px] font-bold">Upload a file</h2>
        </div>
        <div className="border-t border-line p-cardpad">
          <UploadForm />
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-line bg-surface px-cardpad py-10">
          <p className="max-w-[52ch] text-center text-[12.5px] text-muted">
            Your CV variants, tailored versions, and cover letters live here, with a record of
            which version went where. Parsing and tailoring arrive with Tess in later phases.
          </p>
        </div>
      ) : (
        <DocumentList
          documents={docs.map((d) => ({
            id: d.id,
            title: d.title,
            kind: d.kind,
            versions: d.versions.map((v) => ({
              id: v.id,
              version: v.version,
              fileName: v.fileName,
              size: v.size,
              jobId: v.jobId,
              createdAt: v.createdAt.toISOString(),
            })),
          }))}
          jobs={jobs.map((j) => ({ id: j.id, label: `${j.title}, ${j.companyName}` }))}
        />
      )}
      </div>
    </div>
  );
}

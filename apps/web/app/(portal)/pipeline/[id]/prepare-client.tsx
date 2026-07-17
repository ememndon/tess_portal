"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PrepPackage = {
  match: { score: number; reasons: string[]; covered: string[]; missing: string[] };
  tailor: { diff: { skillsAdded: string[]; skillsDropped: string[]; summaryChanged: boolean }; removedClaims: string[]; unconfirmedViolations: string[] };
  ats: { score: number; sections: { name: string; present: boolean }[]; coverage: number; matchedKeywords: string[]; missingKeywords: string[]; fixes: string[] };
  cultureFit: { score: number; jobSignals: string[]; matched: string[]; note: string };
  workSamples: { name: string; description: string; tech: string[] }[];
  coverLetter: string;
  formAnswers: { question: string; answer: string }[];
  documents: { cvDocx: string | null; cvPdf: string | null; coverDocx: string | null; coverPdf: string | null };
};

export function PrepareApplication({
  jobId,
  profileConfirmed,
  currentStage,
}: {
  jobId: string;
  profileConfirmed: boolean;
  currentStage: string;
}) {
  const router = useRouter();
  const [pkg, setPkg] = React.useState<PrepPackage | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [applied, setApplied] = React.useState(currentStage === "applied");

  async function prepare() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/applications/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const payload = (await res.json().catch(() => ({}))) as PrepPackage & { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not prepare the package, try again");
      return;
    }
    setPkg(payload);
  }

  async function markApplied() {
    if (!pkg) return;
    setBusy(true);
    await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        cvVersionId: pkg.documents.cvPdf ?? pkg.documents.cvDocx,
        coverLetterVersionId: pkg.documents.coverPdf ?? pkg.documents.coverDocx,
        formAnswers: pkg.formAnswers,
      }),
    });
    setBusy(false);
    setApplied(true);
    router.refresh();
  }

  if (!profileConfirmed) {
    return (
      <div className="rounded-card border border-line bg-surface p-cardpad text-[12px] text-muted">
        Confirm your CV profile in{" "}
        <a href="/documents" className="font-semibold text-jade">Documents</a> first, then Tess can
        tailor an application for this job.
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">Application package</h2>
        <div className="ml-auto flex gap-2">
          <Button onClick={prepare} disabled={busy}>
            {busy ? "Preparing" : pkg ? "Regenerate" : "Prepare application"}
          </Button>
          {pkg && !applied ? (
            <Button variant="secondary" onClick={markApplied} disabled={busy}>
              Mark applied
            </Button>
          ) : null}
        </div>
      </div>
      {applied ? (
        <div className="border-t border-line px-cardpad py-2 text-[11.5px] text-jade">
          Marked applied. The pipeline moved and the exact document versions sent are logged.
        </div>
      ) : null}
      {error ? <div className="border-t border-line px-cardpad py-2 text-[11.5px] text-red">{error}</div> : null}

      {pkg ? (
        <div className="flex flex-col gap-gap border-t border-line p-cardpad">
          {/* match + downloads */}
          <div className="flex items-start gap-3">
            <ScoreRing score={pkg.match.score} size={48} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold">Match score {pkg.match.score}</div>
              <ul className="mt-1 list-disc pl-4 text-[11.5px] text-muted">
                {pkg.match.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {pkg.documents.cvPdf ? <DownloadChip id={pkg.documents.cvPdf} label="Tailored CV (PDF)" /> : null}
            {pkg.documents.cvDocx ? <DownloadChip id={pkg.documents.cvDocx} label="Tailored CV (DOCX)" /> : null}
            {pkg.documents.coverPdf ? <DownloadChip id={pkg.documents.coverPdf} label="Cover letter (PDF)" /> : null}
            {pkg.documents.coverDocx ? <DownloadChip id={pkg.documents.coverDocx} label="Cover letter (DOCX)" /> : null}
          </div>

          {/* tailoring transparency */}
          <Panel title="Tailoring">
            <div className="text-[11.5px] text-muted">
              Emphasized: {pkg.tailor.diff.skillsAdded.slice(0, 12).join(", ") || "none"}.
              {pkg.tailor.diff.summaryChanged ? " Summary rewritten for this role." : ""}
            </div>
            {pkg.tailor.removedClaims.length > 0 ? (
              <div className="mt-1 text-[11px] text-amber">
                Held back claims your profile does not support: {pkg.tailor.removedClaims.join(", ")}.
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-jade">Every line is backed by your confirmed profile.</div>
            )}
          </Panel>

          {/* ATS */}
          <Panel title={`ATS simulation, score ${pkg.ats.score}`}>
            <div className="mb-1 flex flex-wrap gap-1.5">
              {pkg.ats.sections.map((s) => (
                <span
                  key={s.name}
                  className={cn(
                    "rounded-pill px-[8px] py-[2.5px] text-[10px] font-semibold",
                    s.present ? "bg-jade-dim text-jade" : "bg-red-dim text-red",
                  )}
                >
                  {s.name} {s.present ? "✓" : "✗"}
                </span>
              ))}
            </div>
            <ul className="list-disc pl-4 text-[11.5px] text-muted">
              {pkg.ats.fixes.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </Panel>

          {/* culture fit */}
          <Panel title={`Culture fit ${pkg.cultureFit.score}`}>
            <div className="text-[11.5px] text-muted">{pkg.cultureFit.note}</div>
            {pkg.cultureFit.jobSignals.length > 0 ? (
              <div className="mt-1 text-[11px] text-faint">Posting emphasizes: {pkg.cultureFit.jobSignals.join(", ")}.</div>
            ) : null}
          </Panel>

          {/* work samples */}
          {pkg.workSamples.length > 0 ? (
            <Panel title="Selected work samples">
              {pkg.workSamples.map((w) => (
                <div key={w.name} className="text-[11.5px]">
                  <b>{w.name}</b>
                  {w.tech.length ? <span className="text-faint"> ({w.tech.join(", ")})</span> : null}
                </div>
              ))}
            </Panel>
          ) : null}

          {/* cover letter */}
          <Panel title="Cover letter">
            <pre className="whitespace-pre-wrap font-body text-[11.5px] text-muted">{pkg.coverLetter}</pre>
          </Panel>

          {/* form answers */}
          <Panel title="Common form answers">
            {pkg.formAnswers.map((qa, i) => (
              <div key={i} className="mb-2">
                <div className="text-[11.5px] font-semibold">{qa.question}</div>
                <div className="text-[11.5px] text-muted">{qa.answer || "— fill this in yourself —"}</div>
              </div>
            ))}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] bg-bg p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{title}</div>
      {children}
    </div>
  );
}

function DownloadChip({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`/api/documents/versions/${id}`}
      className="rounded-btn border border-line px-[11px] py-[6px] text-[11px] font-semibold text-jade hover:bg-raised"
    >
      {label}
    </a>
  );
}

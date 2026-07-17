import { NextResponse } from "next/server";
import { z } from "zod";
import { guardedBody, jsonError } from "@/lib/server/api";
import { scopeFor } from "@/lib/server/dal";
import { isGloballyPaused } from "@/lib/ai/meter";
import { embedText } from "@/lib/ai/run";
import { getLogger } from "@/lib/server/health";
import { profileSchema } from "@/lib/cv/schema";
import { matchScore } from "@/lib/match/score";
import { findUnconfirmedClaims, tailorCv } from "@/lib/cv/tailor";
import { generateCoverLetter, generateFormAnswers } from "@/lib/cv/coverletter";
import { cultureFit } from "@/lib/analysis/nlp";
import { simulateAtsFromFile } from "@/lib/cv/ats";
import { coverLetterHtml, cvHtml, renderCoverLetterDocx, renderDocx, toRenderable } from "@/lib/cv/render";
import { renderPdf } from "@/lib/cv/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Prepares the full application package for one job: match score,
 * claim-constrained tailored CV (DOCX and PDF), cover letter, form
 * answers, ATS simulation, work samples, and culture fit. Generated
 * documents are stored and linked to the job. The tailored CV is
 * verified to contain no claim absent from the confirmed profile before
 * anything is written.
 */
export async function POST(req: Request) {
  const guard = await guardedBody(req, z.object({ jobId: z.string().uuid() }));
  if (!guard.ok) return guard.res;
  if (await isGloballyPaused()) return jsonError("the platform is paused by an admin", 503);

  const scope = scopeFor(guard.user.id);
  const job = await scope.getJob(guard.body.jobId);
  if (!job) return jsonError("job not found", 404);

  const profileData = await scope.getConfirmedProfileData();
  if (!profileData) {
    return jsonError("confirm your CV profile first, in Documents or onboarding", 409);
  }
  const profile = profileSchema.parse(profileData);
  const jobText = `${job.title}\n${job.companyName}\n${job.description ?? ""}`;
  const log = getLogger();

  // 1. match score (embedding + keyword gap)
  const profileEmbedding = await scope.getProfileEmbedding();
  const match = matchScore({
    profile,
    jobText,
    jobEmbedding: (job.embedding as number[] | null) ?? null,
    profileEmbedding,
  });

  // 2. tailor under the confirmed-claims constraint
  const { tailored, diff } = await tailorCv(guard.user.id, profile, jobText);
  const unconfirmed = findUnconfirmedClaims(tailored, profile);
  if (unconfirmed.length > 0) {
    // the constraint is hard: refuse rather than ship a fabricated claim
    log.error({ unconfirmed }, "tailored cv contained unconfirmed claims, refused");
    return jsonError(
      `the tailored CV would have asserted skills not in your confirmed profile (${unconfirmed.join(", ")}), so it was refused. Add them to your profile if they are true.`,
      422,
    );
  }

  // 3. render tailored CV to DOCX and PDF
  const renderable = toRenderable(profile, tailored);
  const safeName = (job.companyName || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
  const cvDocx = await renderDocx(renderable);
  const cvPdf = await renderPdf(cvHtml(renderable)).catch((err) => {
    log.error({ err: (err as Error).message }, "cv pdf render failed");
    return null;
  });

  // 4. cover letter + form answers (constrained)
  const [coverLetter, formAnswers] = await Promise.all([
    generateCoverLetter(guard.user.id, profile, { title: job.title, companyName: job.companyName, description: job.description ?? "" }),
    generateFormAnswers(guard.user.id, profile, { title: job.title, companyName: job.companyName, description: job.description ?? "" }),
  ]);
  const contact = [profile.email, profile.phone, profile.location].filter(Boolean).join("  ·  ");
  const coverDocx = await renderCoverLetterDocx(profile.name, contact, coverLetter);
  const coverPdf = await renderPdf(coverLetterHtml(profile.name, contact, coverLetter)).catch(() => null);

  // 5. ATS simulation, re-parsing the generated DOCX with the same extractor
  const ats = await simulateAtsFromFile(cvDocx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "cv.docx", jobText);

  // 6. culture fit
  const culture = cultureFit(jobText, profile.workStyle);

  // 7. persist generated documents linked to the job
  const cvDocxSaved = await scope.saveGeneratedDoc({
    kind: "cv_tailored",
    title: `CV, tailored for ${job.companyName}`,
    fileName: `cv-${safeName}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: cvDocx.toString("base64"),
    jobId: job.id,
    note: `Tailored for ${job.title}`,
  });
  let cvPdfVersion: string | null = null;
  if (cvPdf) {
    const saved = await scope.saveGeneratedDoc({
      kind: "cv_tailored",
      title: `CV (PDF), tailored for ${job.companyName}`,
      fileName: `cv-${safeName}.pdf`,
      mime: "application/pdf",
      base64: cvPdf.toString("base64"),
      jobId: job.id,
    });
    cvPdfVersion = saved.versionId;
  }
  const coverDocxSaved = await scope.saveGeneratedDoc({
    kind: "cover_letter",
    title: `Cover letter for ${job.companyName}`,
    fileName: `cover-${safeName}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: coverDocx.toString("base64"),
    jobId: job.id,
  });
  let coverPdfVersion: string | null = null;
  if (coverPdf) {
    const saved = await scope.saveGeneratedDoc({
      kind: "cover_letter",
      title: `Cover letter (PDF) for ${job.companyName}`,
      fileName: `cover-${safeName}.pdf`,
      mime: "application/pdf",
      base64: coverPdf.toString("base64"),
      jobId: job.id,
    });
    coverPdfVersion = saved.versionId;
  }

  return NextResponse.json({
    ok: true,
    match: { score: match.score, reasons: match.reasons, covered: match.covered, missing: match.missing },
    tailor: { diff, removedClaims: tailored.removedClaims, unconfirmedViolations: unconfirmed },
    ats,
    cultureFit: culture,
    workSamples: tailored.selectedProjects,
    coverLetter,
    formAnswers,
    documents: {
      cvDocx: cvDocxSaved.versionId,
      cvPdf: cvPdfVersion,
      coverDocx: coverDocxSaved.versionId,
      coverPdf: coverPdfVersion,
    },
  });
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const KIND_LABELS: Record<string, string> = {
  cv_base: "Base CV",
  cv_tailored: "Tailored CV",
  cover_letter: "Cover letter",
  other: "Other",
};

export function UploadForm({ documentId }: { documentId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    if (documentId) form.set("documentId", documentId);
    const res = await fetch("/api/documents", { method: "POST", body: form });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "upload failed, try again");
      return;
    }
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor={`file-${documentId ?? "new"}`}>
          {documentId ? "New version file" : "File, DOCX or PDF"}
        </Label>
        <input
          id={`file-${documentId ?? "new"}`}
          name="file"
          type="file"
          required
          accept=".pdf,.docx,.doc,.txt,.md"
          className="block text-[12px] text-muted file:mr-3 file:rounded-btn file:border file:border-line file:bg-transparent file:px-3 file:py-[5px] file:text-[11.5px] file:font-semibold file:text-muted"
        />
      </div>
      {!documentId ? (
        <>
          <div>
            <Label htmlFor="up-title">Title</Label>
            <input
              id="up-title"
              name="title"
              placeholder="My CV"
              className="rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
            />
          </div>
          <div>
            <Label htmlFor="up-kind">Kind</Label>
            <select
              id="up-kind"
              name="kind"
              defaultValue="cv_base"
              className="rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
            >
              <option value="cv_base">Base CV</option>
              <option value="cv_tailored">Tailored CV</option>
              <option value="cover_letter">Cover letter</option>
              <option value="other">Other</option>
            </select>
          </div>
        </>
      ) : null}
      <Button type="submit" variant={documentId ? "secondary" : "primary"} disabled={busy}>
        {busy ? "Uploading" : documentId ? "Add version" : "Upload"}
      </Button>
      {error ? <p className="w-full text-[11.5px] text-red">{error}</p> : null}
    </form>
  );
}

export function DocumentList({
  documents,
  jobs,
}: {
  documents: {
    id: string;
    title: string;
    kind: string;
    versions: {
      id: string;
      version: number;
      fileName: string;
      size: number;
      jobId: string | null;
      createdAt: string;
    }[];
  }[];
  jobs: { id: string; label: string }[];
}) {
  const router = useRouter();

  async function linkToJob(versionId: string, jobId: string) {
    await fetch(`/api/documents/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: jobId || null }),
    });
    router.refresh();
  }

  async function removeDocument(id: string) {
    await fetch("/api/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-gap">
      {documents.map((doc) => (
        <div key={doc.id} className="rounded-card border border-line bg-surface">
          <div className="flex items-center gap-2 p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">{doc.title}</h2>
            <span className="rounded-pill bg-jade-dim px-[8px] py-[2.5px] text-[10px] font-semibold text-jade">
              {KIND_LABELS[doc.kind] ?? doc.kind}
            </span>
            <button
              type="button"
              onClick={() => removeDocument(doc.id)}
              className="ml-auto text-[11px] text-faint hover:text-red"
            >
              Delete
            </button>
          </div>
          {doc.versions.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-3 border-t border-line px-cardpad py-rowpad">
              <span className="font-mono text-[10px] text-faint">v{v.version}</span>
              <a
                href={`/api/documents/versions/${v.id}`}
                className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg hover:text-jade"
              >
                {v.fileName}
              </a>
              <span className="font-mono text-[10px] text-faint">
                {(v.size / 1024).toFixed(0)} KB · {v.createdAt.slice(0, 10)}
              </span>
              <select
                value={v.jobId ?? ""}
                onChange={(e) => linkToJob(v.id, e.target.value)}
                className="rounded-input border border-line bg-bg px-2 py-[4px] text-[11px] text-muted"
                title="Which job did this version go to?"
              >
                <option value="">Not sent to a job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="border-t border-line p-cardpad">
            <UploadForm documentId={doc.id} />
          </div>
        </div>
      ))}
    </div>
  );
}

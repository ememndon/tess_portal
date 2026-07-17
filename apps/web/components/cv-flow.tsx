"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProfileReview } from "@/components/profile-review";
import { EMPTY_PROFILE, type Profile } from "@/lib/cv/schema";

/**
 * Upload a CV, then review and confirm the parsed profile. Wired into
 * onboarding and the Documents page. If a profile already exists it can
 * be re-opened for editing.
 */
export function CvUploadFlow({
  existingProfile,
  confirmed,
  onConfirmed,
}: {
  existingProfile?: Profile | null;
  confirmed?: boolean;
  onConfirmed?: () => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = React.useState<Profile | null>(existingProfile ?? null);
  const [editing, setEditing] = React.useState(!confirmed && Boolean(existingProfile));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/cv/upload", { method: "POST", body: form });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; profile?: Profile };
    setBusy(false);
    if (!res.ok || !payload.profile) {
      setError(payload.error ?? "could not read that CV, try a DOCX or text-based PDF");
      return;
    }
    setProfile(payload.profile);
    setEditing(true);
  }

  if (editing && profile) {
    return (
      <ProfileReview
        initial={profile}
        onConfirmed={() => {
          setEditing(false);
          router.refresh();
          onConfirmed?.();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {confirmed && profile ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface p-3">
          <div className="flex-1">
            <div className="text-[12.5px] font-semibold">{profile.name || "Your profile"} is confirmed</div>
            <div className="text-[11px] text-muted">
              {profile.skills.length} skills, {profile.experience.length} roles. Tess tailors only from this.
            </div>
          </div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Review or edit
          </Button>
        </div>
      ) : null}

      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-line px-[13px] py-[7px] text-[11.5px] font-semibold text-muted hover:bg-raised">
          <input type="file" accept=".pdf,.docx,.doc,.txt" onChange={upload} className="hidden" disabled={busy} />
          {busy ? "Reading your CV" : confirmed ? "Upload a new CV" : "Upload your CV (DOCX or PDF)"}
        </label>
        {!confirmed && !profile ? (
          <button
            type="button"
            onClick={() => {
              setProfile(EMPTY_PROFILE);
              setEditing(true);
            }}
            className="ml-2 text-[11.5px] font-semibold text-jade"
          >
            or enter it by hand
          </button>
        ) : null}
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
    </div>
  );
}

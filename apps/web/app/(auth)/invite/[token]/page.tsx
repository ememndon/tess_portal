import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { gatePassed } from "@/lib/server/auth";
import { findInviteByToken } from "@/lib/server/admin";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Accept invite" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // the universal gate applies to everyone, invitees included; send
  // them back here once they pass it
  if (!(await gatePassed())) redirect(`/gate?next=/invite/${token}`);

  const invite = await findInviteByToken(token);
  if (!invite) {
    return (
      <div className="rounded-card border border-line bg-surface p-5">
        <h1 className="font-disp text-[15px] font-bold">Invite not valid</h1>
        <p className="mt-1 text-[11.5px] text-muted">
          This invite link has expired or was already used. Ask the person who invited you to send
          a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h1 className="font-disp text-[15px] font-bold">Welcome to Tess Portal</h1>
      <p className="mb-4 mt-1 text-[11.5px] text-muted">
        You are joining as <b className="text-fg">{invite.email}</b>. Set your name and password.
      </p>
      <InviteForm token={token} />
    </div>
  );
}

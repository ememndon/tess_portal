"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Contact = { id: string; name: string; role: string | null; companyName: string | null; email: string | null; linkedin: string | null };
type JobOpt = { id: string; label: string };
type Sequence = { id: string; name: string; status: string; steps: { position: number; kind: string; status: string; dueAt: string | null }[] };
type Experiment = { variant: string; sent: number; replied: number };
type Click = { url: string; clickCount: number; clickedAt: string | null };

function Card({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-baseline gap-2 p-cardpad pb-2.5">
        <h2 className="font-disp text-[13.5px] font-bold">{title}</h2>
        {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function OutreachClient(props: {
  contacts: Contact[];
  jobs: JobOpt[];
  sequences: Sequence[];
  experiments: Experiment[];
  clicks: Click[];
}) {
  const router = useRouter();

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">Outreach</h1>
      <p className="mt-1 max-w-[74ch] text-[11.5px] text-muted">
        Contacts, drafts, and sequences. Sending always goes through your approval and, when your
        mailbox is connected, sends from your own address. Without one, you get a copy-ready draft.
        Your actual emails and their replies live in your <a href="/mailbox" className="font-semibold text-jade">Mailbox</a>.
      </p>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
        <FinderCard />

      <Card title="Compose and send">
        <div className="border-t border-line p-cardpad">
          <ComposeForm contacts={props.contacts} jobs={props.jobs} onDone={() => router.refresh()} />
        </div>
      </Card>

      <Card title="Contacts" hint="give a contact an email and Compose fills it in for you">
        <div className="border-t border-line p-cardpad">
          <ContactsManager contacts={props.contacts} onDone={() => router.refresh()} />
        </div>
      </Card>

      <Card title="Sequences" hint="a due follow-up becomes a ready-to-send draft you approve; a reply stops it">
        <div className="border-t border-line p-cardpad">
          <SequenceForm contacts={props.contacts} jobs={props.jobs} onDone={() => router.refresh()} />
        </div>
        {props.sequences.map((s) => (
          <div key={s.id} className="border-t border-line px-cardpad py-rowpad">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-semibold">{s.name}</span>
              <span
                className={cn(
                  "rounded-pill px-[8px] py-[2.5px] font-mono text-[10px]",
                  s.status.startsWith("stopped") ? "bg-track text-faint" : "bg-jade-dim text-jade",
                )}
              >
                {s.status.replace("stopped:", "stopped, ")}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {s.steps.map((st) => (
                <span key={st.position} className="rounded-pill bg-track px-[8px] py-[2.5px] font-mono text-[10px] text-faint">
                  {st.position + 1}. {st.kind} · {st.status}
                  {st.dueAt ? ` · due ${st.dueAt.slice(0, 10)}` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Card>

      {props.experiments.length > 0 ? (
        <Card title="A/B results" hint="reply rate per subject or opener variant">
          <div className="overflow-x-auto border-t border-line p-cardpad">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                  <th className="pb-2 pr-4">Variant</th>
                  <th className="pb-2 pr-4">Sent</th>
                  <th className="pb-2 pr-4">Replied</th>
                  <th className="pb-2">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {props.experiments.map((e) => (
                  <tr key={e.variant} className="border-t border-line">
                    <td className="py-2 pr-4 font-semibold">{e.variant}</td>
                    <td className="py-2 pr-4 font-mono">{e.sent}</td>
                    <td className="py-2 pr-4 font-mono">{e.replied}</td>
                    <td className="py-2 font-mono text-jade">{e.sent > 0 ? Math.round((e.replied / e.sent) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="Portfolio link clicks">
        {props.clicks.length === 0 ? (
          <div className="border-t border-line px-cardpad py-rowpad text-[12px] text-muted">
            Links in your outreach are wrapped and tracked. Clicks show here.
          </div>
        ) : (
          props.clicks.map((c, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-line px-cardpad py-rowpad">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{c.url}</span>
              <span className="font-mono text-[11px] text-jade">{c.clickCount} click{c.clickCount === 1 ? "" : "s"}</span>
              {c.clickedAt ? <span className="font-mono text-[10px] text-faint">last {c.clickedAt.slice(0, 10)}</span> : null}
            </div>
          ))
        )}
      </Card>
      </div>
    </div>
  );
}

/** Best-effort email guess from a person's name and a company domain. */
function domainOf(website: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
function guessEmail(name: string, domain: string | null): string {
  if (!domain) return "";
  const parts = name.trim().toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const local = parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
  return `${local}@${domain}`;
}

function FinderCard() {
  const router = useRouter();
  const [company, setCompany] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [emails, setEmails] = React.useState<Record<number, string>>({});
  const [added, setAdded] = React.useState<Set<number>>(new Set());
  const [result, setResult] = React.useState<{ suggestions: { name: string; role: string; source: string; confidence: string }[]; searchLinks: { label: string; url: string }[] } | null>(null);

  async function find() {
    setBusy(true);
    setEmails({});
    setAdded(new Set());
    const res = await fetch("/api/outreach/find-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, website: website || "" }),
    });
    setBusy(false);
    if (res.ok) setResult(await res.json());
  }

  async function addContact(i: number, name: string, role: string) {
    const email = (emails[i] ?? "").trim();
    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, companyName: company, email: email || undefined }),
    });
    setAdded((s) => new Set(s).add(i));
    router.refresh();
  }

  const domain = domainOf(website);

  return (
    <Card title="Find hiring managers" hint="suggestions with sources, nothing is added until you confirm">
      <div className="flex flex-wrap gap-2 border-t border-line p-cardpad">
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="max-w-[220px]" />
        <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://company.com (optional)" className="max-w-[260px]" />
        <Button onClick={find} disabled={busy || !company.trim()}>
          {busy ? "Searching" : "Find people"}
        </Button>
      </div>
      {result ? (
        <div className="border-t border-line p-cardpad">
          {result.suggestions.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
              <div className="min-w-[140px] flex-1">
                <span className="text-[12.5px] font-semibold">{s.name}</span>
                {s.role ? <span className="text-[11px] text-muted"> · {s.role}</span> : null}
                <a href={s.source} target="_blank" rel="noopener noreferrer" className="ml-2 font-mono text-[10px] text-jade">
                  source
                </a>
                {s.confidence === "search_lead" ? <span className="ml-1 text-[10px] text-faint">(lead)</span> : null}
              </div>
              {s.confidence === "found_on_site" ? (
                added.has(i) ? (
                  <span className="text-[11px] font-semibold text-jade">Added ✓</span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={emails[i] ?? ""}
                      onChange={(e) => setEmails((m) => ({ ...m, [i]: e.target.value }))}
                      placeholder="email (optional)"
                      className="h-[28px] w-[190px] text-[11px]"
                    />
                    {domain && !(emails[i] ?? "").trim() ? (
                      <button
                        type="button"
                        title={`Guess ${guessEmail(s.name, domain)}`}
                        onClick={() => setEmails((m) => ({ ...m, [i]: guessEmail(s.name, domain) }))}
                        className="rounded-btn border border-line px-2 py-[5px] text-[10.5px] text-muted hover:bg-raised"
                      >
                        guess
                      </button>
                    ) : null}
                    <Button variant="secondary" onClick={() => addContact(i, s.name, s.role)}>
                      Add
                    </Button>
                  </div>
                )
              ) : null}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-2">
            {result.searchLinks.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-btn border border-line px-[10px] py-[5px] text-[11px] font-semibold text-jade hover:bg-raised">
                {l.label}
              </a>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-faint">
            Tip: a “guess” is only a best effort at the address pattern — confirm it before you rely on it.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function ContactsManager({ contacts, onDone }: { contacts: Contact[]; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editEmail, setEditEmail] = React.useState("");

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        role: data.role || undefined,
        companyName: data.companyName || undefined,
        email: data.email || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not add the contact");
      return;
    }
    form.reset();
    onDone();
  }

  async function saveEmail(id: string) {
    await fetch("/api/contacts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, email: editEmail.trim() }),
    });
    setEditing(null);
    onDone();
  }

  async function remove(id: string) {
    await fetch("/api/contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    onDone();
  }

  return (
    <div className="flex flex-col gap-2.5">
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input name="name" placeholder="Name" className="max-w-[160px]" required />
        <Input name="role" placeholder="Role" className="max-w-[150px]" />
        <Input name="companyName" placeholder="Company" className="max-w-[150px]" />
        <Input name="email" type="email" placeholder="Email" className="max-w-[200px]" />
        <Button type="submit" disabled={busy}>Add contact</Button>
        {error ? <p className="w-full text-[11.5px] text-red">{error}</p> : null}
      </form>

      {contacts.length === 0 ? (
        <p className="text-[12px] text-muted">No contacts yet. Add people here, or use “Find hiring managers” above.</p>
      ) : (
        <div className="rounded-[10px] border border-line">
          {contacts.map((c, i) => (
            <div key={c.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", i > 0 && "border-t border-line")}>
              <div className="min-w-[130px] flex-1">
                <div className="text-[12.5px] font-semibold">{c.name}</div>
                <div className="truncate text-[11px] text-muted">{[c.role, c.companyName].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              {editing === c.id ? (
                <div className="flex items-center gap-1.5">
                  <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" placeholder="email" className="h-[28px] w-[190px] text-[11px]" autoFocus />
                  <button type="button" onClick={() => saveEmail(c.id)} className="text-[11px] font-semibold text-jade">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="text-[11px] text-faint">Cancel</button>
                </div>
              ) : c.email ? (
                <button
                  type="button"
                  onClick={() => { setEditing(c.id); setEditEmail(c.email ?? ""); }}
                  className="font-mono text-[10.5px] text-faint hover:text-jade"
                  title="Edit email"
                >
                  {c.email}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditing(c.id); setEditEmail(""); }}
                  className="rounded-btn border border-line px-2 py-[4px] text-[10.5px] font-semibold text-jade hover:bg-raised"
                >
                  + Add email
                </button>
              )}
              <button type="button" onClick={() => remove(c.id)} className="text-[11px] text-faint hover:text-red">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeForm({ contacts, jobs, onDone }: { contacts: Contact[]; jobs: JobOpt[]; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const res = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request_send",
        toEmail: data.toEmail,
        subject: data.subject,
        body: data.body,
        jobId: data.jobId || undefined,
        contactId: data.contactId || undefined,
        variant: data.variant || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(payload.error ?? "could not queue the send");
      return;
    }
    setNotice("Queued for your approval. Approve it in Notifications to send.");
    (e.target as HTMLFormElement).reset();
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Label>Contact</Label>
          <select name="contactId" className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg"
            onChange={(e) => {
              const c = contacts.find((x) => x.id === e.target.value);
              const emailInput = e.currentTarget.form?.elements.namedItem("toEmail") as HTMLInputElement | null;
              if (c?.email && emailInput) emailInput.value = c.email;
            }}
          >
            <option value="">Pick a contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.companyName ? `, ${c.companyName}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>To email</Label>
          <Input name="toEmail" type="email" required placeholder="manager@company.com" />
        </div>
        <div>
          <Label>Job (optional)</Label>
          <select name="jobId" className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg">
            <option value="">No job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>A/B variant (optional)</Label>
          <Input name="variant" placeholder="subject-A" />
        </div>
      </div>
      <div>
        <Label>Subject</Label>
        <Input name="subject" required />
      </div>
      <div>
        <Label>Body</Label>
        <textarea name="body" rows={5} required className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg" />
        <p className="mt-1 text-[10.5px] text-faint">Links you include are wrapped and tracked automatically.</p>
      </div>
      {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
      {notice ? <p className="text-[11.5px] text-jade">{notice}</p> : null}
      <div>
        <Button type="submit" disabled={busy}>Queue for approval</Button>
      </div>
    </form>
  );
}

function SequenceForm({ contacts, jobs, onDone }: { contacts: Contact[]; jobs: JobOpt[]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [steps, setSteps] = React.useState([
    { kind: "email", waitDays: 0 },
    { kind: "follow_up", waitDays: 4 },
    { kind: "follow_up", waitDays: 7 },
  ]);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_sequence",
        name: data.name,
        jobId: data.jobId || undefined,
        contactId: data.contactId || undefined,
        steps,
      }),
    });
    setBusy(false);
    setOpen(false);
    onDone();
  }

  if (!open) return <Button onClick={() => setOpen(true)}>Create a sequence</Button>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div><Label>Name</Label><Input name="name" required placeholder="Arden Labs outreach" /></div>
        <div>
          <Label>Contact</Label>
          <select name="contactId" className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg">
            <option value="">Pick a contact</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Job</Label>
          <select name="jobId" className="w-full rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-fg">
            <option value="">No job</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label>Steps (cadence in days between each)</Label>
        {steps.map((s, i) => (
          <div key={i} className="mb-1 flex gap-2">
            <select value={s.kind} onChange={(e) => setSteps((c) => c.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))} className="rounded-input border border-line bg-bg px-2 py-[5px] text-[11.5px] text-fg">
              <option value="email">Email</option>
              <option value="follow_up">Follow-up</option>
              <option value="recruiter_message">Recruiter message</option>
              <option value="board_application">Board application</option>
            </select>
            <Input type="number" value={s.waitDays} min={0} max={60} onChange={(e) => setSteps((c) => c.map((x, j) => (j === i ? { ...x, waitDays: Number(e.target.value) } : x)))} className="w-[90px]" />
            <button type="button" onClick={() => setSteps((c) => c.filter((_, j) => j !== i))} className="text-[11px] text-faint hover:text-red">×</button>
          </div>
        ))}
        <button type="button" onClick={() => setSteps((c) => [...c, { kind: "follow_up", waitDays: 5 }])} className="text-[11px] font-semibold text-jade">Add step</button>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>Create sequence</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

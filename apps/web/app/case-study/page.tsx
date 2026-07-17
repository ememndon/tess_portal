import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Tess Portal was built",
  description:
    "A case study in building a private, AI-operated job search platform: isolation, a free-first model router, approval-gated actions, and no fabricated claims.",
  robots: { index: true, follow: true },
};

const phases = [
  { n: "0", t: "Foundation", d: "An isolated five-container stack on a shared VPS, no published ports, secrets in an encrypted vault, additive migrations." },
  { n: "1", t: "Access and isolation", d: "A two-layer gate, hashed invite links, and a scoped data access layer that is the single row-level isolation boundary." },
  { n: "2", t: "Pipeline", d: "A drag-and-drop board, permanent job snapshots, documents with went-where links, a calendar with reminders, and typo-tolerant search." },
  { n: "3", t: "Tess", d: "A free-first model router, a persona that holds real conversations, and an approval gate enforced in the tool layer so nothing sensitive runs unasked." },
  { n: "4", t: "Discovery", d: "Seven ATS adapters, RSS and crawling, currency-normalized salaries, sponsor matching, and dedup by fingerprint, trigram, and embedding." },
  { n: "5", t: "Applications", d: "CV parsing into a strict profile, tailoring under a hard no-unconfirmed-claim constraint, and generated documents rendered to PDF." },
  { n: "6", t: "Outreach", d: "Approval-gated sending from the user's own mailbox, inbox classification, follow-up sequences, and tracked links." },
  { n: "7", t: "Intelligence", d: "Sourced company briefs, salary intelligence, auto-generated interview prep, a mock interview mode, and honest closed-loop insights." },
  { n: "8", t: "Ship", d: "Encrypted nightly backups with restore verification, an email deliverability monitor, a strict content security policy, and this page." },
];

const principles = [
  { t: "Isolation by construction", d: "Every read and write on personal data passes through one scoped layer that filters by the owner. No admin view ever exposes another person's pipeline, documents, chats, or mailbox." },
  { t: "Nothing leaves without a yes", d: "Sending, submitting, and deleting are never automatic. They become approval records with a frozen snapshot of exactly what was approved, enforced in the execution layer so no prompt can bypass it." },
  { t: "No invented claims", d: "A tailored CV can only contain what the confirmed profile backs. A company brief cites the pages it read. Salary advice comes from real postings. When the data is thin, the platform says so." },
  { t: "Free first, capped, honest", d: "The model router walks a free-first chain, meters every call, and degrades to free models at the spend cap rather than failing. Every figure carries its sample size." },
  { t: "Secrets stay secret", d: "API keys, mailbox credentials, and the backup key live only in an encrypted, write-only vault. They never appear in a log, an error, a response, or the admin panel." },
];

export default function CaseStudyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-[760px] bg-bg px-5 py-14 text-fg">
      <div className="mb-10 flex items-center gap-2.5">
        <span
          className="inline-block h-[22px] w-[22px] rounded-[6px]"
          style={{ background: "linear-gradient(140deg, #34C98E, #1E8F66)" }}
        />
        <span className="font-disp text-[15px] font-extrabold tracking-[-0.02em]">Tess Portal</span>
      </div>

      <h1 className="font-disp text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em]">
        A job search run by an agent, built to be trusted.
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Tess Portal is a private, invite-only platform where an AI agent named Tess runs a person&apos;s job search:
        she discovers roles, researches companies, tailors documents, drafts outreach, and prepares interviews. The
        interesting part was never the features. It was building something an agent could operate on your behalf that
        you could actually trust. This is how it was done, phase by phase.
      </p>

      <section className="mt-10">
        <h2 className="font-disp text-[16px] font-bold tracking-[-0.02em]">The principles</h2>
        <div className="mt-4 flex flex-col gap-4">
          {principles.map((p) => (
            <div key={p.t} className="rounded-card border border-line bg-surface p-4">
              <div className="text-[13.5px] font-semibold text-jade">{p.t}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-disp text-[16px] font-bold tracking-[-0.02em]">Eight phases</h2>
        <p className="mt-2 text-[13px] text-muted">
          Each phase was built to a locked specification, verified against its own acceptance checks, and only then
          followed by the next. Nothing shipped on faith.
        </p>
        <ol className="mt-4 flex flex-col gap-3">
          {phases.map((p) => (
            <li key={p.n} className="flex gap-3 rounded-card border border-line bg-surface p-4">
              <span className="font-mono text-[13px] font-semibold text-jade">{p.n}</span>
              <div>
                <div className="text-[13.5px] font-semibold">{p.t}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{p.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-disp text-[16px] font-bold tracking-[-0.02em]">The stack</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Next.js and TypeScript on the front, a Postgres database with pgvector for semantic memory and Meilisearch
          for instant search, a Redis-backed job scheduler for everything that runs on a clock, and a worker that
          crawls, embeds, polls mailboxes, and takes encrypted backups. The AI layer is a custom router over a chain of
          providers, metered live and capped. Every screen follows one calm design system built around a single jade
          accent.
        </p>
      </section>

      <footer className="mt-12 border-t border-line pt-6 text-[12px] text-faint">
        <p>
          Tess Portal is invite-only.{" "}
          <Link href="/gate" className="text-jade hover:underline">
            Members sign in here
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}

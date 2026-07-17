import type { Metadata } from "next";
import { DateTime } from "luxon";
import { requireOnboardedUser } from "@/lib/server/auth";
import { scopeFor } from "@/lib/server/dal";
import type { PrepPack } from "@/lib/intel/prep";
import { InterviewForm, InterviewRow, OfferForm, OfferRow } from "./interviews-client";
import { StoryBank } from "./stories-client";

export const metadata: Metadata = { title: "Interviews & Offers" };
export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  const user = await requireOnboardedUser();
  const scope = scopeFor(user.id);
  const [interviews, offers, jobs, settings, prepPacks, stories] = await Promise.all([
    scope.listInterviews(),
    scope.listOffers(),
    scope.listJobs(),
    scope.getSettings(),
    scope.listPrepPacks(),
    scope.listStories(),
  ]);
  const zone = settings.timezone;
  const jobOptions = jobs.map((j) => ({ id: j.id, label: `${j.title}, ${j.companyName}` }));
  const packByInterview = new Map<string, PrepPack>();
  for (const p of prepPacks) {
    if (p.interviewId && !packByInterview.has(p.interviewId)) {
      packByInterview.set(p.interviewId, p.content as PrepPack);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        Interviews &amp; Offers
      </h1>

      <div className="mt-gap columns-1 [column-gap:var(--gap)] @4xl:columns-2 [&>*]:mb-gap [&>*]:break-inside-avoid">
      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center p-cardpad pb-2.5">
          <h2 className="font-disp text-[13.5px] font-bold">Interviews</h2>
          <span className="ml-2 font-mono text-[10px] text-faint">times in {zone}</span>
        </div>
        <div className="border-t border-line p-cardpad">
          {jobOptions.length === 0 ? (
            <p className="text-[12px] text-muted">Add a job to the pipeline first.</p>
          ) : (
            <InterviewForm jobs={jobOptions} />
          )}
        </div>
        {interviews.map((row) => (
          <InterviewRow
            key={row.interview.id}
            id={row.interview.id}
            round={row.interview.round}
            medium={row.interview.medium}
            outcome={row.interview.outcome}
            jobLabel={`${row.jobTitle}, ${row.jobCompany}`}
            localTime={DateTime.fromJSDate(row.interview.scheduledAt, { zone }).toFormat(
              "ccc d LLL yyyy, HH:mm",
            )}
            upcoming={row.interview.scheduledAt > new Date()}
            prepPack={packByInterview.get(row.interview.id) ?? null}
          />
        ))}
      </div>

      <StoryBank stories={stories.map((s) => ({
        id: s.id,
        title: s.title,
        competency: s.competency,
        situation: s.situation,
        task: s.task,
        action: s.action,
        result: s.result,
      }))} />

      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center p-cardpad pb-2.5">
          <h2 className="font-disp text-[13.5px] font-bold">Offers</h2>
        </div>
        <div className="border-t border-line p-cardpad">
          {jobOptions.length === 0 ? (
            <p className="text-[12px] text-muted">Offers attach to pipeline jobs.</p>
          ) : (
            <OfferForm jobs={jobOptions} />
          )}
        </div>
        {offers.map((row) => (
          <OfferRow
            key={row.offer.id}
            id={row.offer.id}
            jobLabel={`${row.jobTitle}, ${row.jobCompany}`}
            baseSalary={row.offer.baseSalary}
            currency={row.offer.currency}
            period={row.offer.period}
            bonus={row.offer.bonus}
            deadline={row.offer.deadline}
          />
        ))}
      </div>

      {offers.length >= 2 ? (
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center p-cardpad pb-2.5">
            <h2 className="font-disp text-[13.5px] font-bold">Offer comparison</h2>
          </div>
          <div className="overflow-x-auto border-t border-line p-cardpad">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                  <th className="pb-2 pr-4">Offer</th>
                  <th className="pb-2 pr-4">Base</th>
                  <th className="pb-2 pr-4">Bonus</th>
                  <th className="pb-2 pr-4">Equity</th>
                  <th className="pb-2 pr-4">Relocation</th>
                  <th className="pb-2 pr-4">Benefits</th>
                  <th className="pb-2">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((row) => (
                  <tr key={row.offer.id} className="border-t border-line">
                    <td className="py-2 pr-4 font-semibold">{row.jobCompany}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">
                      {row.offer.baseSalary
                        ? `${row.offer.currency} ${Number(row.offer.baseSalary).toLocaleString()} / ${row.offer.period}`
                        : "n/a"}
                    </td>
                    <td className="py-2 pr-4 text-muted">{row.offer.bonus ?? "none"}</td>
                    <td className="py-2 pr-4 text-muted">{row.offer.equity ?? "none"}</td>
                    <td className="py-2 pr-4 text-muted">{row.offer.relocation ?? "none"}</td>
                    <td className="py-2 pr-4 text-muted">{row.offer.benefits ?? "none"}</td>
                    <td className="py-2 font-mono text-[11px]">{row.offer.deadline ?? "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}

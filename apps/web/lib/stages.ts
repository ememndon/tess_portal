export const STAGES = [
  { key: "saved", label: "Saved", color: "var(--stage-saved)" },
  { key: "researching", label: "Researching", color: "var(--stage-researching)" },
  { key: "applied", label: "Applied", color: "var(--stage-applied)" },
  { key: "outreach", label: "Outreach Sent", color: "var(--stage-outreach)" },
  { key: "interview", label: "Interview", color: "var(--stage-interview)" },
  { key: "offer", label: "Offer", color: "var(--stage-offer)" },
  { key: "rejected", label: "Rejected", color: "var(--stage-rejected)" },
  { key: "ghosted", label: "Ghosted", color: "var(--stage-ghosted)" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export function stageOf(key: string) {
  return STAGES.find((s) => s.key === key) ?? STAGES[0];
}

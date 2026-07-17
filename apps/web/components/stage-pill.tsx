import { stageOf } from "@/lib/stages";

/** Stage pill: stage color as text on a 12% tint of the same color. */
export function StagePill({ stage }: { stage: string }) {
  const s = stageOf(stage);
  return (
    <span
      className="rounded-pill px-[8px] py-[2.5px] text-[10px] font-semibold whitespace-nowrap"
      style={{
        color: s.color,
        background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
      }}
    >
      {s.label}
    </span>
  );
}

import { Button } from "@/components/ui/button";

/**
 * Empty state per the design system: one plain sentence saying what
 * belongs here and one action button. No illustrations. Actions activate
 * in their own phases; until then the button is disabled.
 */
export function EmptyState({
  title,
  sentence,
  action,
  actionReady = false,
  children,
}: {
  title: string;
  sentence: string;
  action: string;
  actionReady?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-gap">
      <h1 className="font-disp text-[var(--fs-title)] font-extrabold tracking-[-0.02em]">
        {title}
      </h1>
      <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-cardpad py-10">
        <p className="max-w-[52ch] text-center text-[12.5px] text-muted">{sentence}</p>
        <Button disabled={!actionReady} title={actionReady ? undefined : "Available in a later phase"}>
          {action}
        </Button>
      </div>
      {children}
    </div>
  );
}

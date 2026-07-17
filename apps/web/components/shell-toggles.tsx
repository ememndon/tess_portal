"use client";

import { MessageCircle, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

/** Collapses/expands the left navigation panel. */
export function LeftToggle() {
  const { toggleLeft, leftOpen } = useShell();
  return (
    <button
      type="button"
      onClick={toggleLeft}
      aria-label={leftOpen ? "Hide navigation" : "Show navigation"}
      aria-pressed={leftOpen}
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-btn border border-line text-muted hover:bg-raised hover:text-fg"
    >
      <PanelLeft size={15} />
    </button>
  );
}

/** Collapses/expands the right Tess chat rail. */
export function RightToggle() {
  const { toggleRight, rightOpen } = useShell();
  return (
    <button
      type="button"
      onClick={toggleRight}
      aria-label={rightOpen ? "Hide Tess chat" : "Show Tess chat"}
      aria-pressed={rightOpen}
      className={cn(
        "flex h-[30px] shrink-0 items-center gap-1.5 rounded-btn border px-2.5 text-[11.5px] font-semibold",
        rightOpen
          ? "border-jade-line bg-jade-dim text-jade"
          : "border-line text-muted hover:bg-raised hover:text-fg",
      )}
    >
      <MessageCircle size={14} />
      Tess
    </button>
  );
}

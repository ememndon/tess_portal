"use client";

import * as React from "react";

/**
 * Shared control surface for the app shell's two collapsible side panels.
 * The AppShell provides it; the top-bar toggles and the sidebar's Chat
 * item consume it to open/close the nav and the Tess rail.
 */
export type ShellState = {
  leftOpen: boolean;
  rightOpen: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  openRight: () => void;
};

export const ShellContext = React.createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within <AppShell>");
  return ctx;
}

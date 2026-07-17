"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "tessportal-theme";

function applyTheme(theme: "dark" | "light") {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable, theme still applies for this page
  }
  // persist to user settings; harmless 401 on the auth screens
  fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
}

function useTheme() {
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  React.useEffect(() => {
    setTheme(
      document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
    );
  }, []);
  const set = React.useCallback((next: "dark" | "light") => {
    applyTheme(next);
    setTheme(next);
  }, []);
  return { theme, set };
}

/** Icon toggle for the top bar. */
export function ThemeToggle() {
  const { theme, set } = useTheme();
  return (
    <button
      type="button"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => set(theme === "dark" ? "light" : "dark")}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-line bg-bg text-muted hover:bg-raised hover:text-fg"
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

/** Labeled theme picker for the Settings page. */
export function ThemePicker() {
  const { theme, set } = useTheme();
  return (
    <div className="flex gap-2">
      {(["dark", "light"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => set(t)}
          className={cn(
            "rounded-btn border px-[13px] py-[6px] text-[11.5px] font-semibold capitalize",
            theme === t
              ? "border-jade-line bg-jade-dim text-jade"
              : "border-line bg-transparent text-muted hover:bg-raised hover:text-fg",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

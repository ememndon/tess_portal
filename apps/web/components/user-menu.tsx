"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const initial = (name.trim()[0] || email[0] || "?").toUpperCase();

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-pill border border-line bg-raised text-[12px] font-semibold text-jade"
      >
        {initial}
      </button>
      {open ? (
        <div className="absolute right-0 top-[38px] z-50 w-[200px] rounded-[10px] border border-line bg-surface p-1.5 shadow-none">
          <div className="px-2.5 py-1.5">
            <div className="text-[12.5px] font-semibold text-fg">{name}</div>
            <div className="truncate font-mono text-[10.5px] text-faint">{email}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block rounded-[7px] px-2.5 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-fg"
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="block w-full rounded-[7px] px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-raised hover:text-fg"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

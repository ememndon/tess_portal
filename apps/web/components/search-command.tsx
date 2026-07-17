"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Group = {
  index: string;
  hits: { id: string; title: string; subtitle?: string; href: string }[];
};

const GROUP_LABELS: Record<string, string> = {
  jobs: "Jobs",
  companies: "Companies",
  contacts: "Contacts",
  documents: "Documents",
};

/** Instant search: Ctrl K, typo tolerant through Meilisearch. */
export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else {
      setQuery("");
      setGroups([]);
    }
  }, [open]);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setGroups([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = (await res.json()) as { groups: Group[] };
          setGroups(data.groups);
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full max-w-[420px] items-center gap-2 rounded-input border border-line bg-bg px-3 py-[7px] text-[12.5px] text-faint hover:bg-raised"
      >
        Search jobs, companies, contacts
        <span className="ml-auto rounded-[5px] border border-line px-[5px] py-px font-mono text-[10px] text-faint">
          Ctrl K
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-[520px] rounded-card border border-line bg-surface">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search jobs, companies, contacts, documents"
              className="w-full rounded-t-card border-b border-line bg-transparent px-4 py-3 text-[13px] text-fg placeholder:text-faint focus:outline-none"
            />
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {query.trim().length < 2 ? (
                <p className="px-2.5 py-3 text-[11.5px] text-faint">
                  Type at least two characters. Typos are fine.
                </p>
              ) : loading && groups.length === 0 ? (
                <p className="px-2.5 py-3 text-[11.5px] text-faint">Searching</p>
              ) : groups.length === 0 ? (
                <p className="px-2.5 py-3 text-[11.5px] text-faint">Nothing matches that.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.index}>
                    <div className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
                      {GROUP_LABELS[g.index] ?? g.index}
                    </div>
                    {g.hits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(hit.href);
                        }}
                        className="flex w-full items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left hover:bg-raised"
                      >
                        <span className="truncate text-[12.5px] font-semibold text-fg">
                          {hit.title}
                        </span>
                        {hit.subtitle ? (
                          <span className="truncate text-[11px] text-muted">{hit.subtitle}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

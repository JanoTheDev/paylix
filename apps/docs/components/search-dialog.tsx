"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Heading {
  text: string;
  anchor: string;
}

interface Entry {
  title: string;
  description?: string;
  path: string;
  headings: Heading[];
}

type Result =
  | { kind: "page"; entry: Entry; score: number }
  | { kind: "heading"; entry: Entry; heading: Heading; score: number };

function score(haystack: string, query: string): number {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  const idx = h.indexOf(q);
  if (idx >= 0) return 60 - Math.min(20, idx);
  // Token subset match: every query token appears somewhere.
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => h.includes(t))) return 30;
  return 0;
}

function rank(entries: Entry[], query: string): Result[] {
  if (!query.trim()) return [];
  const out: Result[] = [];
  for (const entry of entries) {
    const titleScore = score(entry.title, query);
    const descScore = entry.description ? score(entry.description, query) : 0;
    const pageScore = Math.max(titleScore, descScore * 0.6);
    if (pageScore > 0) {
      out.push({ kind: "page", entry, score: pageScore });
    }
    for (const heading of entry.headings) {
      const s = score(heading.text, query);
      if (s > 0) {
        out.push({ kind: "heading", entry, heading, score: s * 0.9 });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 20);
}

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || entries) return;
    fetch("/search-index.json")
      .then((r) => r.json())
      .then((data) => setEntries(data as Entry[]))
      .catch(() => setEntries([]));
  }, [open, entries]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const results = useMemo(
    () => (entries ? rank(entries, query) : []),
    [entries, query],
  );

  const close = useCallback(() => setOpen(false), []);

  function hrefFor(r: Result): string {
    if (r.kind === "page") return r.entry.path;
    return `${r.entry.path}#${r.heading.anchor}`;
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) {
        window.location.href = hrefFor(r);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-surface-1 px-3 py-1.5 text-left text-xs text-foreground-muted transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Search className="size-3.5" />
        <span className="flex-1">Search docs</span>
        <kbd className="rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] text-foreground-dim">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={close}
            aria-label="Close search"
          />
          <div
            className="relative z-10 mt-[12vh] w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="size-4 text-foreground-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search docs…"
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
              />
              <button
                type="button"
                onClick={close}
                className="text-foreground-muted transition-colors hover:text-foreground"
                aria-label="Close search"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
              {!entries ? (
                <div className="px-3 py-6 text-center text-xs text-foreground-muted">
                  Loading index…
                </div>
              ) : query.trim() === "" ? (
                <div className="px-3 py-6 text-center text-xs text-foreground-muted">
                  Type to search. Use ↑ ↓ to move, Enter to open, Esc to close.
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-foreground-muted">
                  No matches for <span className="font-mono">{query}</span>.
                </div>
              ) : (
                <ul>
                  {results.map((r, i) => {
                    const href = hrefFor(r);
                    const title =
                      r.kind === "page" ? r.entry.title : r.heading.text;
                    const crumb =
                      r.kind === "heading" ? r.entry.title : undefined;
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          onClick={close}
                          onMouseEnter={() => setActiveIdx(i)}
                          className={cn(
                            "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors",
                            i === activeIdx
                              ? "bg-surface-2 text-foreground"
                              : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
                          )}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate">{title}</span>
                            {crumb && (
                              <span className="shrink-0 text-[11px] text-foreground-dim">
                                in {crumb}
                              </span>
                            )}
                          </span>
                          {r.kind === "page" && r.entry.description && (
                            <span className="line-clamp-1 text-xs text-foreground-dim">
                              {r.entry.description}
                            </span>
                          )}
                          <span className="font-mono text-[11px] text-foreground-dim">
                            {href}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

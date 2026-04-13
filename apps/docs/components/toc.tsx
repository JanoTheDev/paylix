"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export function Toc() {
  const pathname = usePathname();
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const headings = Array.from(
      main.querySelectorAll("h2, h3"),
    ) as HTMLElement[];

    const usedIds = new Set<string>();
    headings.forEach((h) => {
      if (!h.id) {
        h.id = (h.textContent ?? "")
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-")
          .slice(0, 60);
      }
      let slug = h.id;
      if (usedIds.has(slug)) {
        let i = 2;
        while (usedIds.has(`${slug}-${i}`)) i++;
        slug = `${slug}-${i}`;
        h.id = slug;
      }
      usedIds.add(slug);
    });

    const tocItems: TocItem[] = headings
      .filter((h) => h.id)
      .map((h) => ({
        id: h.id,
        text: h.textContent ?? "",
        level: h.tagName === "H2" ? 2 : 3,
      }));
    setItems(tocItems);
    setActiveId(tocItems[0]?.id ?? null);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [pathname]);

  if (items.length === 0) return null;

  return (
    <nav>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.8px] text-foreground-dim">
        On this page
      </p>
      <ul className="space-y-1.5 border-l border-border">
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? "pl-4" : ""}>
            <a
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
                history.pushState(null, "", `#${item.id}`);
              }}
              className={cn(
                "-ml-px block border-l-2 pl-3 text-[13px] transition-colors",
                activeId === item.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-foreground-muted hover:text-foreground",
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

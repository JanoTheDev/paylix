import fs from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";

const baseUrl = "https://docs.paylix.io";

/**
 * The sitemap is derived from the filesystem rather than hand-maintained: a
 * hand-written array silently goes stale every time someone adds a page (it
 * had drifted 12+ pages behind before this was generated). Mirrors the route
 * derivation in scripts/build-search-index.mjs — strip `/page.tsx`, drop
 * `(group)` segments, skip `[dynamic]` routes.
 */
const appDir = path.join(process.cwd(), "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

function toRoute(filePath: string): string | null {
  const stripped = path
    .relative(appDir, filePath)
    .replace(/\\/g, "/")
    .replace(/\/?page\.tsx$/, "")
    .split("/")
    .filter((seg) => seg !== "" && !seg.startsWith("("))
    .join("/");
  if (stripped === "") return "/";
  if (stripped.split("/").some((seg) => seg.startsWith("[") && seg.endsWith("]"))) {
    return null;
  }
  return `/${stripped}`;
}

/**
 * Priority buckets. Anything not listed falls through to 0.7 — new pages get a
 * reasonable default instead of being omitted entirely.
 */
function priorityFor(route: string): number {
  if (route === "/") return 1;
  if (route === "/sdk-reference" || route === "/frameworks") return 0.9;
  if (route.startsWith("/sdk-reference/")) return 0.85;
  if (route.startsWith("/frameworks/")) return 0.8;
  if (route === "/changelog") return 0.5;
  return 0.7;
}

function changeFrequencyFor(
  route: string,
): MetadataRoute.Sitemap[number]["changeFrequency"] {
  if (route === "/" || route.startsWith("/sdk-reference")) return "weekly";
  return "monthly";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const routes = Array.from(
    new Set(
      walk(appDir)
        .map(toRoute)
        .filter((r): r is string => r !== null),
    ),
  ).sort();

  return routes.map((route) => ({
    url: route === "/" ? baseUrl : `${baseUrl}${route}`,
    lastModified,
    changeFrequency: changeFrequencyFor(route),
    priority: priorityFor(route),
  }));
}

#!/usr/bin/env node
/**
 * Walk apps/docs/app/**\/page.tsx, pull the metadata title, the page's
 * hero description, and every <SectionHeading> / <SubsectionHeading> /
 * heading tag into a flat search index written to public/search-index.json.
 *
 * Regex-based on purpose: pages are consistent and a real AST parser
 * would pull in @babel/* just to save a few edge cases.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");
const outFile = path.resolve(__dirname, "../public/search-index.json");

/** @type {{ title: string; description?: string; path: string; headings: { text: string; anchor: string }[] }[]} */
const entries = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (name === "page.tsx") entries.push(...extract(full));
  }
}

function toRoute(filePath) {
  const rel = path.relative(appDir, filePath).replace(/\\/g, "/");
  // Strip trailing /page.tsx and group segments like (dashboard).
  const stripped = rel
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((seg) => !seg.startsWith("("))
    .join("/");
  if (stripped === "" || stripped === "page.tsx") return "/";
  // Skip dynamic routes ([foo]) from the search index — they don't
  // resolve to a concrete page a user can click.
  if (stripped.split("/").some((seg) => seg.startsWith("[") && seg.endsWith("]"))) {
    return null;
  }
  return "/" + stripped;
}

function extract(file) {
  const src = fs.readFileSync(file, "utf8");
  const route = toRoute(file);
  if (!route) return [];

  const metadataTitle = matchFirst(
    src,
    /export\s+const\s+metadata[^}]*?title:\s*["'`]([^"'`]+)["'`]/,
  );
  const pageHeadingTitle = matchFirst(
    src,
    /<PageHeading[\s\S]*?title=\{?["'`]([^"'`]+)["'`]\}?/,
  );
  const pageHeadingDesc = matchFirst(
    src,
    /<PageHeading[\s\S]*?description=(?:\{)?["'`]([^"'`]+)["'`]/,
  );

  const title =
    metadataTitle?.replace(/\s*—\s*Paylix Docs?/, "") ||
    pageHeadingTitle ||
    route;

  const headings = [];
  const headingRe =
    /<(SectionHeading|SubsectionHeading)[^>]*>([\s\S]*?)<\/\1>/g;
  for (let m = headingRe.exec(src); m; m = headingRe.exec(src)) {
    const text = cleanInnerText(m[2]);
    if (!text) continue;
    headings.push({ text, anchor: slugify(text) });
  }

  // Plain <h1>...<h3> too (some pages use raw elements).
  const hRe = /<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/g;
  for (let m = hRe.exec(src); m; m = hRe.exec(src)) {
    const text = cleanInnerText(m[2]);
    if (!text) continue;
    if (headings.some((h) => h.text === text)) continue;
    headings.push({ text, anchor: slugify(text) });
  }

  return [
    {
      title,
      description: pageHeadingDesc ?? undefined,
      path: route,
      headings,
    },
  ];
}

function matchFirst(src, re) {
  const m = src.match(re);
  return m ? m[1].trim() : null;
}

function cleanInnerText(raw) {
  return raw
    .replace(/\{[^}]*\}/g, " ") // {expressions}
    .replace(/<[^>]+>/g, " ") // nested tags
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

walk(appDir);

entries.sort((a, b) => a.path.localeCompare(b.path));

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(entries, null, 2));

console.log(
  `[search-index] Wrote ${entries.length} pages to ${path.relative(
    process.cwd(),
    outFile,
  )}`,
);

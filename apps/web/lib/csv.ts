/**
 * Tiny RFC 4180 CSV formatter. Escapes fields that contain a comma,
 * quote, CR, or LF by wrapping in double quotes and doubling any
 * internal quote. Nulls + undefineds render as empty cells.
 *
 * Pure + streaming-friendly: `toCsvRow` emits a single line, callers
 * chain rows onto a ReadableStream without building the whole file
 * in memory.
 */

export type CsvCell = string | number | bigint | boolean | Date | null | undefined;

const NEEDS_QUOTING = /[",\r\n]/;

export function formatCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "bigint") s = value.toString();
  else if (typeof value === "boolean") s = value ? "true" : "false";
  else s = String(value);
  if (NEEDS_QUOTING.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsvRow(cells: CsvCell[]): string {
  return cells.map(formatCell).join(",");
}

export function toCsvLine(cells: CsvCell[]): string {
  return toCsvRow(cells) + "\r\n";
}

/**
 * Flatten a metadata record into `metadata.<key>` cells, pulling the
 * keys from the supplied ordering so every row in a file lines up.
 */
export function metadataCells(
  metadata: Record<string, string> | null | undefined,
  keys: string[],
): CsvCell[] {
  if (!metadata) return keys.map(() => null);
  return keys.map((k) => metadata[k] ?? null);
}

export function metadataKeys(
  rows: Array<{ metadata?: Record<string, string> | null }>,
): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.metadata) continue;
    for (const k of Object.keys(row.metadata)) keys.add(k);
  }
  return Array.from(keys).sort();
}

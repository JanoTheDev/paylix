export const CSV_MAX_ROWS = 50_000;

export function csvResponse(
  body: string,
  filename: string,
  count: number,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Paylix-Row-Count": String(count),
  };
  if (count >= CSV_MAX_ROWS) {
    headers["X-Paylix-Truncated"] = "true";
  }
  return new Response(body, { headers });
}

export function csvFilename(resource: string, livemode: boolean): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const mode = livemode ? "live" : "test";
  return `paylix-${resource}-${mode}-${stamp}.csv`;
}

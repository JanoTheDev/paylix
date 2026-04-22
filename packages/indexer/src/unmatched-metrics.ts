export interface RetryPassInput {
  queueDepthBefore: number;
  retriedRows: Array<{ createdAt: Date; matched: boolean }>;
  nowMs: number;
}

export interface RetryPassSummary {
  event: "unmatched_retry_pass";
  pending: number;
  retried: number;
  matched: number;
  ageSecondsP95: number;
  oldestAgeSeconds: number;
}

export const UNMATCHED_PENDING_WARN_THRESHOLD = 50;
export const UNMATCHED_AGE_WARN_SECONDS = 5 * 60;

export function summarizeRetryPass(input: RetryPassInput): RetryPassSummary {
  const { queueDepthBefore, retriedRows, nowMs } = input;
  const ages = retriedRows
    .map((r) => Math.max(0, Math.floor((nowMs - r.createdAt.getTime()) / 1000)))
    .sort((a, b) => a - b);
  const ageSecondsP95 = percentile(ages, 0.95);
  const oldestAgeSeconds = ages.length === 0 ? 0 : ages[ages.length - 1];
  const matched = retriedRows.filter((r) => r.matched).length;
  return {
    event: "unmatched_retry_pass",
    pending: queueDepthBefore,
    retried: retriedRows.length,
    matched,
    ageSecondsP95,
    oldestAgeSeconds,
  };
}

export function shouldWarn(summary: RetryPassSummary): boolean {
  return (
    summary.pending > UNMATCHED_PENDING_WARN_THRESHOLD ||
    summary.oldestAgeSeconds > UNMATCHED_AGE_WARN_SECONDS
  );
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.ceil(p * sortedAsc.length) - 1,
  );
  return sortedAsc[Math.max(0, idx)];
}

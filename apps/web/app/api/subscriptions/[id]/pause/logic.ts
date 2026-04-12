type PauseInput = { status: string };
type PauseResult =
  | { ok: true; update: { status: "paused"; pausedAt: Date } }
  | { ok: false; reason: string };

export function computePauseUpdate(sub: PauseInput, now: Date): PauseResult {
  if (sub.status !== "active") {
    return { ok: false, reason: `cannot pause subscription in status '${sub.status}'` };
  }
  return { ok: true, update: { status: "paused", pausedAt: now } };
}

type ResumeInput = { status: string; pausedAt: Date | null; nextChargeDate: Date | null };
type ResumeResult =
  | { ok: true; update: { status: "active"; pausedAt: null; nextChargeDate: Date | null } }
  | { ok: false; reason: string };

export function computeResumeUpdate(sub: ResumeInput, now: Date): ResumeResult {
  if (sub.status !== "paused" || !sub.pausedAt) {
    return { ok: false, reason: `cannot resume subscription in status '${sub.status}'` };
  }
  const pausedMs = now.getTime() - sub.pausedAt.getTime();
  const nextChargeDate = sub.nextChargeDate
    ? new Date(sub.nextChargeDate.getTime() + Math.max(0, pausedMs))
    : null;
  return { ok: true, update: { status: "active", pausedAt: null, nextChargeDate } };
}

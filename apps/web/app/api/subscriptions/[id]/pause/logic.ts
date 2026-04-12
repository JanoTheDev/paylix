type PauseInput = { status: string };
type PauseResult =
  | { ok: true; update: { status: "paused"; pausedAt: Date } }
  | { ok: false; reason: string };

/**
 * Pauses are only allowed from `active` — not from `past_due`, `trialing`, etc.
 *
 * This is deliberate: if pause were allowed from `past_due`, the sub's existing
 * `pastDueSince` timestamp would be preserved across the pause, and a long
 * pause could cause the long-past-due sweep to cancel the sub the moment it's
 * resumed. Any future relaxation of this gate MUST also clear or freeze
 * `pastDueSince` in `computePauseUpdate`, and `computeResumeUpdate` must
 * recompute it correctly on the other side.
 */
export function computePauseUpdate(sub: PauseInput, now: Date): PauseResult {
  if (sub.status !== "active") {
    return { ok: false, reason: `cannot pause subscription in status '${sub.status}'` };
  }
  return { ok: true, update: { status: "paused", pausedAt: now } };
}

type ResumeInput = { status: string; pausedAt: Date | null; nextChargeDate: Date | null };
type ResumeResult =
  | {
      ok: true;
      update: {
        status: "active";
        pausedAt: null;
        nextChargeDate: Date | null;
        chargeFailureCount: 0;
        lastChargeError: null;
        pastDueSince: null;
      };
    }
  | { ok: false; reason: string };

export function computeResumeUpdate(sub: ResumeInput, now: Date): ResumeResult {
  if (sub.status !== "paused" || !sub.pausedAt) {
    return { ok: false, reason: `cannot resume subscription in status '${sub.status}'` };
  }
  const pausedMs = now.getTime() - sub.pausedAt.getTime();
  const nextChargeDate = sub.nextChargeDate
    ? new Date(sub.nextChargeDate.getTime() + Math.max(0, pausedMs))
    : null;
  return {
    ok: true,
    update: {
      status: "active",
      pausedAt: null,
      nextChargeDate,
      chargeFailureCount: 0,
      lastChargeError: null,
      pastDueSince: null,
    },
  };
}

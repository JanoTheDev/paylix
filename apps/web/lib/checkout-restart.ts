export type CheckoutRestartAction = "reuse" | "create_new" | "not_found";

export interface RestartableSession {
  status:
    | "awaiting_currency"
    | "active"
    | "viewed"
    | "abandoned"
    | "completed"
    | "expired";
  expiresAt: Date;
}

/**
 * Decide what the /checkout/restart/[sessionId] route should do for a
 * given session. Pure so we can unit-test the branching without touching
 * the DB.
 *
 * - `reuse`: session is still live — redirect to /checkout/[sessionId].
 * - `create_new`: session is done (completed/expired/abandoned) or has
 *   run past its expiresAt even if still marked active. Clone and redirect.
 * - `not_found`: input is null (session id didn't resolve).
 */
export function classifyRestart(
  session: RestartableSession | null,
  now: Date,
): CheckoutRestartAction {
  if (!session) return "not_found";

  const pastExpiry = session.expiresAt.getTime() <= now.getTime();

  if (session.status === "completed") return "create_new";
  if (session.status === "expired") return "create_new";
  if (session.status === "abandoned") return "create_new";

  if (pastExpiry) return "create_new";

  return "reuse";
}

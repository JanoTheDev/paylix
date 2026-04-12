export function formatTrialRemaining(
  trialEndsAt: Date | string | null,
): string {
  if (!trialEndsAt) return "";
  const end =
    typeof trialEndsAt === "string" ? new Date(trialEndsAt) : trialEndsAt;
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return "ending now";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `ends in ${days}d`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `ends in ${hours}h`;
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `ends in ${minutes}m`;
}

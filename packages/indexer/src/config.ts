import { getDeployments, type Deployment } from "@paylix/config/deployments";

export const deployments: Deployment[] = getDeployments();

/**
 * Required string env var. Fails at boot with a clear message instead of
 * surfacing as an obscure "connection string undefined" error deep inside a
 * payment handler.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[Config] ${name} is required but was not set. Add it to the indexer environment.`,
    );
  }
  return value.trim();
}

/**
 * Numeric env var that must parse to a finite integer >= 0. `parseInt` alone
 * yields NaN for garbage input, and NaN silently degrades every consumer:
 * `setTimeout(fn, NaN)` fires immediately (tight loop) and `BigInt(NaN)` throws
 * at module load.
 */
export function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `[Config] ${name} must be an integer >= 0, got "${raw}"`,
    );
  }
  return parsed;
}

/** Same as parseNonNegativeIntEnv but rejects 0 (chunk sizes, intervals). */
export function parsePositiveIntEnv(name: string, fallback: number): number {
  const value = parseNonNegativeIntEnv(name, fallback);
  if (value === 0) {
    throw new Error(`[Config] ${name} must be an integer > 0, got "0"`);
  }
  return value;
}

// Shared config applies across every deployment.
export const config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  keeperPrivateKey: requireEnv("KEEPER_PRIVATE_KEY") as `0x${string}`,
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined,
  keeperIntervalMinutes: parsePositiveIntEnv("KEEPER_INTERVAL_MINUTES", 60),
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
  defaultFromEmail: process.env.INVOICE_FROM_EMAIL ?? "invoices@paylix.local",
};

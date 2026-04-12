import { and, eq, type SQL } from "drizzle-orm";

type ScopedTable = {
  organizationId: unknown;
  livemode: unknown;
};

export interface Ctx {
  organizationId: string;
  livemode: boolean;
}

/**
 * Builds the WHERE clause that scopes a query to (organization, livemode).
 *
 * Use anywhere a query previously did:
 *   .where(and(eq(table.organizationId, ctx.organizationId), ...otherFilters))
 *
 * Replace with:
 *   .where(and(orgScope(table, ctx), ...otherFilters))
 *
 * This helper enforces that every read + write is mode-scoped — callers
 * cannot forget to filter on livemode because there's no longer a one-filter
 * shortcut to copy from.
 */
export function orgScope<T extends ScopedTable>(table: T, ctx: Ctx): SQL {
  return and(
    eq(table.organizationId as never, ctx.organizationId),
    eq(table.livemode as never, ctx.livemode),
  )!;
}

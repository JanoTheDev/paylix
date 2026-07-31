import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { member } from "@paylix/db/schema";
import { auth } from "./auth";
import { db } from "./db";
import { apiError } from "./api-error";
import { getDashboardLivemode } from "./request-mode";

type SessionLike = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Organization roles, most-privileged first. better-auth's organization
 * plugin writes `owner` for the creator (see lib/auth.ts) and `admin` /
 * `member` for invitees.
 */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles allowed to perform money-moving or account-destructive actions. */
export const PRIVILEGED_ROLES: readonly OrgRole[] = ["owner", "admin"];

/** Roles allowed to change org membership or delete the account. */
export const OWNER_ONLY: readonly OrgRole[] = ["owner"];

function isOrgRole(value: unknown): value is OrgRole {
  return (
    typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value)
  );
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function requireActiveOrg(session: SessionLike): string {
  if (!session) {
    throw new AuthError("Unauthorized", 401);
  }
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null }
  ).activeOrganizationId;
  if (!activeOrganizationId) {
    throw new AuthError("No active team selected", 400);
  }
  return activeOrganizationId;
}

/**
 * Look up the caller's role in an organization.
 *
 * Fails closed: an unknown role string, or a session whose
 * `activeOrganizationId` has no matching `member` row, yields `null` and the
 * caller is treated as having no access at all. The session's active org is
 * client-influenced state — membership has to be proven against the DB.
 */
export async function getOrgRole(
  organizationId: string,
  userId: string,
): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  if (!row) return null;
  const role = row.role?.toLowerCase() ?? "";
  return isOrgRole(role) ? role : null;
}

export interface ActiveOrgContext {
  ok: true;
  organizationId: string;
  userId: string;
  livemode: boolean;
  role: OrgRole;
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
}

export async function resolveActiveOrg(): Promise<
  ActiveOrgContext | { ok: false; response: NextResponse }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  try {
    const organizationId = requireActiveOrg(session);
    const userId = session!.user.id;

    const role = await getOrgRole(organizationId, userId);
    if (!role) {
      // Membership could not be proven — deny rather than inheriting access
      // from a stale `activeOrganizationId` on the session.
      return {
        ok: false,
        response: apiError(
          "forbidden",
          "You are not a member of this team",
          403,
        ),
      };
    }

    const livemode = await getDashboardLivemode();
    return {
      ok: true,
      organizationId,
      userId,
      livemode,
      role,
      session: session!,
    };
  } catch (e) {
    if (e instanceof AuthError) {
      const code = e.status === 401 ? "unauthorized" : "no_active_team";
      return {
        ok: false,
        response: apiError(code, e.message, e.status),
      };
    }
    throw e;
  }
}

/**
 * Role gate for destructive / money-moving endpoints.
 *
 * Returns `null` when the caller is allowed, otherwise the 403 response the
 * route should return immediately:
 *
 *   const auth = await resolveActiveOrg();
 *   if (!auth.ok) return auth.response;
 *   const denied = requireRole(auth, PRIVILEGED_ROLES);
 *   if (denied) return denied;
 *
 * Fails closed on a missing/unknown role.
 */
export function requireRole(
  ctx: { role?: OrgRole | null },
  allowed: readonly OrgRole[] = PRIVILEGED_ROLES,
): NextResponse | null {
  if (!ctx.role || !allowed.includes(ctx.role)) {
    return apiError(
      "forbidden",
      `This action requires one of the following team roles: ${allowed.join(", ")}`,
      403,
    );
  }
  return null;
}

export type RoleResult =
  | { ok: true; role: OrgRole }
  | { ok: false; response: NextResponse };

/**
 * Async role gate matching the `{ ok }` discriminated-union shape the rest of
 * the API layer uses:
 *
 *   const ctx = await resolveActiveOrg();
 *   if (!ctx.ok) return ctx.response;
 *   const role = await assertRole(ctx, PRIVILEGED_ROLES);
 *   if (!role.ok) return role.response;
 *
 * Reuses `ctx.role` when `resolveActiveOrg` already resolved it, and falls
 * back to a lookup for callers that only carry `{ organizationId, userId }`.
 * Fails closed either way.
 */
export async function assertRole(
  ctx: { organizationId: string; userId: string; role?: OrgRole | null },
  allowed: readonly OrgRole[] = PRIVILEGED_ROLES,
): Promise<RoleResult> {
  const role = ctx.role ?? (await getOrgRole(ctx.organizationId, ctx.userId));
  if (!role || !allowed.includes(role)) {
    return {
      ok: false,
      response: apiError(
        "forbidden",
        `This action requires one of the following team roles: ${allowed.join(", ")}`,
        403,
      ),
    };
  }
  return { ok: true, role };
}

/** Convenience predicate for read-only UI decisions (badges, disabled buttons). */
export function hasRole(
  ctx: { role?: OrgRole | null },
  allowed: readonly OrgRole[] = PRIVILEGED_ROLES,
): boolean {
  return !!ctx.role && allowed.includes(ctx.role);
}

export async function getActiveOrgOrRedirect(): Promise<{
  organizationId: string;
  userId: string;
  livemode: boolean;
  role: OrgRole;
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const activeOrgId = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  if (!activeOrgId) redirect("/onboarding");
  const role = await getOrgRole(activeOrgId, session.user.id);
  if (!role) redirect("/onboarding");
  const livemode = await getDashboardLivemode();
  return {
    organizationId: activeOrgId,
    userId: session.user.id,
    livemode,
    role,
    session,
  };
}

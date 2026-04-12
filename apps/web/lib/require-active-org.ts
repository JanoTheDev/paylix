import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { apiError } from "./api-error";

type SessionLike = Awaited<ReturnType<typeof auth.api.getSession>>;

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

export async function resolveActiveOrg(): Promise<
  | {
      ok: true;
      organizationId: string;
      userId: string;
      session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
    }
  | { ok: false; response: NextResponse }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  try {
    const organizationId = requireActiveOrg(session);
    return {
      ok: true,
      organizationId,
      userId: session!.user.id,
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

export async function getActiveOrgOrRedirect(): Promise<{
  organizationId: string;
  userId: string;
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const activeOrgId = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  if (!activeOrgId) redirect("/onboarding");
  return { organizationId: activeOrgId, userId: session.user.id, session };
}

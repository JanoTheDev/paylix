import { auth } from "@/lib/auth";
import { authenticateApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { customers } from "@paylix/db/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { signPortalToken } from "@/lib/portal-tokens";
import { requireActiveOrg } from "@/lib/require-active-org";
import { getDashboardLivemode } from "@/lib/request-mode";
import { orgScope } from "@/lib/org-scope";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let organizationId: string | null = null;
  let livemode = false;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    try {
      organizationId = requireActiveOrg(session);
      livemode = await getDashboardLivemode();
    } catch {
      return NextResponse.json({ error: { code: "no_active_org", message: "No active team selected" } }, { status: 400 });
    }
  } else {
    const apiAuth = await authenticateApiKey(request, "secret");
    if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
    if (apiAuth) {
      organizationId = apiAuth.organizationId;
      livemode = apiAuth.livemode;
    }
  }
  if (!organizationId) return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });

  const { id } = await params;
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), orgScope(customers, { organizationId, livemode })));

  if (!customer) return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });

  // signPortalToken throws when BETTER_AUTH_SECRET is unset or too short —
  // that's a deployment misconfiguration, not a client error, so surface it
  // as a typed 500 rather than an unhandled exception.
  let token: string;
  try {
    token = signPortalToken(customer.id);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "portal_not_configured",
          message:
            "Customer portal links are unavailable: BETTER_AUTH_SECRET is not configured.",
        },
      },
      { status: 500 },
    );
  }
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return NextResponse.json({
    url: `${baseUrl}/portal/${customer.id}?token=${token}`,
  });
}

import { auth } from "@/lib/auth";
import { authenticateApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { customers } from "@paylix/db/schema";
import { eq, and } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { signPortalToken } from "@/lib/portal-tokens";
import { requireActiveOrg } from "@/lib/require-active-org";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let organizationId: string | null = null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    try {
      organizationId = requireActiveOrg(session);
    } catch {
      return NextResponse.json({ error: { code: "no_active_org", message: "No active team selected" } }, { status: 400 });
    }
  } else {
    const apiAuth = await authenticateApiKey(request, "secret");
    if (apiAuth?.rateLimitResponse) return apiAuth.rateLimitResponse;
    if (apiAuth) organizationId = apiAuth.organizationId;
  }
  if (!organizationId) return NextResponse.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });

  const { id } = await params;
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)));

  if (!customer) return NextResponse.json({ error: { code: "not_found", message: "Customer not found" } }, { status: 404 });

  const token = signPortalToken(customer.id);
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return NextResponse.json({
    url: `${baseUrl}/portal/${customer.id}?token=${token}`,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, member } from "@paylix/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { apiError } from "@/lib/api-error";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "../../_shared/client-ip";
import { readJsonBody } from "../../_shared/http";

// Typing the account email is the confirmation step — a stray POST from a
// CSRF-adjacent path or a mis-wired button can no longer hard-delete an
// account in one call.
const deleteSchema = z.object({
  confirmEmail: z.string().trim().max(254),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return apiError("unauthorized", "Not signed in", 401);
  }

  const rawBody = await readJsonBody(request);
  if (!rawBody.ok) return rawBody.response;
  const parsed = deleteSchema.safeParse(rawBody.data);
  if (
    !parsed.success ||
    parsed.data.confirmEmail.toLowerCase() !== session.user.email.toLowerCase()
  ) {
    return apiError(
      "confirmation_required",
      "Send { confirmEmail } matching your account email to confirm deletion.",
      400,
    );
  }

  // Refuse when the user is the sole owner of an organization: deleting them
  // cascades their membership away and leaves the org with no administrator
  // and no route back to its payments, keys or payout wallet.
  const ownerships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.role, "owner")));

  for (const owned of ownerships) {
    const [otherOwner] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, owned.organizationId),
          eq(member.role, "owner"),
          ne(member.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!otherOwner) {
      return apiError(
        "sole_owner",
        "You are the only owner of a team. Transfer ownership or delete the team first.",
        409,
      );
    }
  }

  // Audit BEFORE the delete: the row's foreign keys go away with the user,
  // and an untraceable account deletion is exactly the event worth keeping.
  for (const owned of ownerships) {
    await recordAudit({
      organizationId: owned.organizationId,
      userId: session.user.id,
      action: "user.deleted",
      resourceType: "user",
      resourceId: session.user.id,
      ipAddress: clientIp(request),
    });
  }

  await db.delete(user).where(eq(user.id, session.user.id));

  return NextResponse.json({ ok: true });
}

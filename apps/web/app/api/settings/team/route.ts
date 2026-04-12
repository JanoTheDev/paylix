import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { member, invitation, user, organization as orgTable } from "@paylix/db/schema";
import { resolveActiveOrg } from "@/lib/require-active-org";

export async function GET() {
  const ctx = await resolveActiveOrg();
  if (!ctx.ok) return ctx.response;
  const { organizationId: orgId, userId } = ctx;

  const [members, pending, [org]] = await Promise.all([
    db
      .select({
        memberId: member.id,
        role: member.role,
        joinedAt: member.createdAt,
        userId: user.id,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .leftJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, orgId)),
    db
      .select()
      .from(invitation)
      .where(
        and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")),
      ),
    db.select().from(orgTable).where(eq(orgTable.id, orgId)),
  ]);

  const currentUserMember = members.find((m) => m.userId === userId);
  const isOwner = currentUserMember?.role === "owner";

  return NextResponse.json({
    members: members.map((m) => ({
      ...m,
      joinedAt: m.joinedAt instanceof Date ? m.joinedAt.toISOString() : m.joinedAt,
    })),
    pending: pending.map((p) => ({
      ...p,
      expiresAt: p.expiresAt instanceof Date ? p.expiresAt.toISOString() : p.expiresAt,
    })),
    currentUserId: userId,
    isOwner,
    org: org ?? null,
  });
}

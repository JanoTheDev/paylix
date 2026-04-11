import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, invitation, user, organization as orgTable } from "@paylix/db/schema";
import { requireActiveOrg } from "@/lib/require-active-org";
import { TeamMembersTable } from "./members-table";
import { PendingInvitesTable } from "./pending-invites-table";
import { InviteForm } from "./invite-form";
import { DangerZoneActions } from "./danger-zone";

export default async function TeamSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  let orgId: string;
  try {
    orgId = requireActiveOrg(session);
  } catch {
    redirect("/onboarding");
  }

  const members = await db
    .select({
      memberId: member.id,
      role: member.role,
      joinedAt: member.createdAt,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(member)
    .leftJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

  const pending = await db
    .select()
    .from(invitation)
    .where(
      and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")),
    );

  const [org] = await db
    .select()
    .from(orgTable)
    .where(eq(orgTable.id, orgId));

  const currentUserMember = members.find((m) => m.userId === session!.user.id);
  const isOwner = currentUserMember?.role === "owner";

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Team</h1>
        <p className="text-sm text-slate-400">
          Manage members and invitations for this team.
        </p>
      </div>
      <InviteForm />
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Members</h2>
        <TeamMembersTable
          rows={members}
          currentUserId={session!.user.id}
          canRemove={isOwner}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Pending invites</h2>
        <PendingInvitesTable rows={pending} />
      </section>
      {isOwner && org && (
        <section className="space-y-3 rounded-lg border border-red-900/40 p-4">
          <h2 className="text-sm font-medium text-red-400">Danger zone</h2>
          <p className="text-xs text-slate-500">
            Transfer ownership or delete this team. These actions are irreversible.
          </p>
          <DangerZoneActions
            members={members.map((m) => ({
              memberId: m.memberId,
              userId: m.userId,
              email: m.email,
            }))}
            currentUserId={session!.user.id}
            orgId={org.id}
            orgSlug={org.slug}
          />
        </section>
      )}
    </div>
  );
}

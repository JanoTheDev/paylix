import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invitation, organization, user } from "@paylix/db/schema";
import { eq } from "drizzle-orm";
import { EmptyState } from "@/components/paykit/empty-state";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const [row] = await db
    .select({
      invitation,
      organization,
      inviter: user,
    })
    .from(invitation)
    .leftJoin(organization, eq(invitation.organizationId, organization.id))
    .leftJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.id, invitationId));

  if (!row) {
    return (
      <FullScreen>
        <EmptyState
          title="Invitation not found"
          description="This link is invalid or has been deleted."
        />
      </FullScreen>
    );
  }
  if (row.invitation.status !== "pending") {
    return (
      <FullScreen>
        <EmptyState
          title="Invitation unavailable"
          description="This invitation has already been used or canceled."
        />
      </FullScreen>
    );
  }
  if (row.invitation.expiresAt < new Date()) {
    return (
      <FullScreen>
        <EmptyState
          title="Invitation expired"
          description={`Ask ${row.inviter?.name ?? row.inviter?.email ?? "the inviter"} to send you a new one.`}
        />
      </FullScreen>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const target = new URLSearchParams({
      invite: invitationId,
      email: row.invitation.email,
    });
    redirect(`/register?${target.toString()}`);
  }

  if (session.user.email !== row.invitation.email) {
    return (
      <FullScreen>
        <EmptyState
          title="Wrong account"
          description={`This invite is for ${row.invitation.email}, but you're signed in as ${session.user.email}.`}
          action={
            <Link href="/auth/logout" className="text-primary hover:underline text-sm">
              Sign out
            </Link>
          }
        />
      </FullScreen>
    );
  }

  await auth.api.acceptInvitation({
    headers: await headers(),
    body: { invitationId },
  });

  redirect("/overview");
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {children}
      </div>
    </div>
  );
}

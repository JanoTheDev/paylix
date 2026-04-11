import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { invitation, organization, user } from "@paylix/db/schema";
import { eq } from "drizzle-orm";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const row = await db
    .select({
      invitation,
      organization,
      inviter: user,
    })
    .from(invitation)
    .leftJoin(organization, eq(invitation.organizationId, organization.id))
    .leftJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.id, invitationId))
    .then((r) => r[0]);

  if (!row) {
    return (
      <Notice
        title="Invitation not found"
        body="This link is invalid or has been deleted."
      />
    );
  }
  if (row.invitation.status !== "pending") {
    return (
      <Notice
        title="Invitation unavailable"
        body="This invitation has already been used or canceled."
      />
    );
  }
  if (row.invitation.expiresAt < new Date()) {
    return (
      <Notice
        title="Invitation expired"
        body={`Ask ${row.inviter?.name ?? row.inviter?.email ?? "the inviter"} to send you a new one.`}
      />
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
      <Notice
        title="Wrong account"
        body={`This invite is for ${row.invitation.email}, but you're signed in as ${session.user.email}.`}
        cta={{ href: "/auth/logout", label: "Sign out" }}
      />
    );
  }

  await auth.api.acceptInvitation({
    headers: await headers(),
    body: { invitationId },
  });

  redirect("/overview");
}

function Notice({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="min-h-screen bg-[#07070a] flex items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        <p className="text-sm text-slate-400">{body}</p>
        {cta && (
          <Link
            href={cta.href}
            className="inline-block text-[#06d6a0] hover:underline"
          >
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}

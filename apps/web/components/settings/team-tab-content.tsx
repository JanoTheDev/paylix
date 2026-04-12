"use client";

import { useCallback, useEffect, useState } from "react";
import { FormSection } from "@/components/paykit";
import { TeamMembersTable } from "@/app/(dashboard)/settings/team/members-table";
import { PendingInvitesTable } from "@/app/(dashboard)/settings/team/pending-invites-table";
import { InviteForm } from "@/app/(dashboard)/settings/team/invite-form";

interface TeamMember {
  memberId: string;
  role: string;
  joinedAt: Date;
  userId: string | null;
  name: string | null;
  email: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  expiresAt: Date;
  status: string;
}

export function TeamTabContent() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/team");
      if (!res.ok) return;
      const data = await res.json();
      setMembers(
        (data.members ?? []).map((m: TeamMember & { joinedAt: string }) => ({
          ...m,
          joinedAt: new Date(m.joinedAt),
        })),
      );
      setPending(
        (data.pending ?? []).map((p: PendingInvite & { expiresAt: string }) => ({
          ...p,
          expiresAt: new Date(p.expiresAt),
        })),
      );
      setCurrentUserId(data.currentUserId ?? "");
      setIsOwner(data.isOwner ?? false);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-foreground-muted">Loading team...</p>;
  }

  return (
    <div className="space-y-6">
      <FormSection
        title="Invite a teammate"
        description="Send an email invitation. They'll get a link to join."
      >
        <InviteForm />
      </FormSection>

      <FormSection
        title="Members"
        description="Everyone currently in this team."
      >
        <TeamMembersTable
          rows={members}
          currentUserId={currentUserId}
          canRemove={isOwner}
        />
      </FormSection>

      {pending.length > 0 && (
        <FormSection
          title="Pending invites"
          description="Invitations that haven't been accepted yet."
        >
          <PendingInvitesTable rows={pending} />
        </FormSection>
      )}
    </div>
  );
}

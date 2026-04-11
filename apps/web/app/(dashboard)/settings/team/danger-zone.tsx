"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Member = { memberId: string; userId: string | null; email: string | null };

export function DangerZoneActions({
  members,
  currentUserId,
  orgId,
  orgSlug,
}: {
  members: Member[];
  currentUserId: string;
  orgId: string;
  orgSlug: string;
}) {
  const router = useRouter();
  const [transferTo, setTransferTo] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const eligible = members.filter((m) => m.userId !== currentUserId);

  async function transfer() {
    if (!transferTo) return;
    setBusy(true);
    await authClient.organization.updateMemberRole({
      memberId: transferTo,
      role: "owner",
    });
    const me = members.find((m) => m.userId === currentUserId);
    if (me) {
      await authClient.organization.updateMemberRole({
        memberId: me.memberId,
        role: "member",
      });
    }
    router.refresh();
    setBusy(false);
  }

  async function deleteTeam() {
    if (deleteConfirm !== `delete ${orgSlug}`) return;
    setBusy(true);
    await authClient.organization.delete({ organizationId: orgId });
    router.push("/onboarding");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-slate-500">
          Transfer ownership
        </h3>
        <div className="flex gap-2">
          <select
            className="bg-slate-900 border border-slate-800 text-slate-100 text-sm rounded-md px-2 py-2"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
          >
            <option value="">Select member…</option>
            {eligible.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.email}
              </option>
            ))}
          </select>
          <Button onClick={transfer} disabled={busy || !transferTo}>
            Transfer
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-slate-500">
          Delete team
        </h3>
        <p className="text-xs text-slate-500">
          Type <code className="text-slate-300">delete {orgSlug}</code> to confirm.
        </p>
        <div className="flex gap-2">
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={`delete ${orgSlug}`}
          />
          <Button
            variant="destructive"
            onClick={deleteTeam}
            disabled={busy || deleteConfirm !== `delete ${orgSlug}`}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

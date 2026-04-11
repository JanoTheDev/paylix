"use client";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type Row = {
  memberId: string;
  role: string;
  joinedAt: Date;
  userId: string | null;
  name: string | null;
  email: string | null;
};

export function TeamMembersTable({
  rows,
  currentUserId,
  canRemove,
}: {
  rows: Row[];
  currentUserId: string;
  canRemove: boolean;
}) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-md border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/40 text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Joined</th>
            {canRemove && <th className="px-3 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => (
            <tr key={r.memberId}>
              <td className="px-3 py-2 text-slate-100">{r.name ?? "—"}</td>
              <td className="px-3 py-2 text-slate-300">{r.email ?? "—"}</td>
              <td className="px-3 py-2 text-slate-300">{r.role}</td>
              <td className="px-3 py-2 text-slate-500">
                {new Date(r.joinedAt).toLocaleDateString()}
              </td>
              {canRemove && (
                <td className="px-3 py-2 text-right">
                  {r.userId !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!confirm(`Remove ${r.email}?`)) return;
                        await authClient.organization.removeMember({
                          memberIdOrEmail: r.memberId,
                        });
                        router.refresh();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

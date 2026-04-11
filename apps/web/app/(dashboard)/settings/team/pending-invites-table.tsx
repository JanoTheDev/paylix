"use client";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  email: string;
  expiresAt: Date;
  status: string;
};

export function PendingInvitesTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No pending invites.</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/40 text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Expires</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-slate-100">{r.email}</td>
              <td className="px-3 py-2 text-slate-500">
                {new Date(r.expiresAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await authClient.organization.cancelInvitation({
                      invitationId: r.id,
                    });
                    router.refresh();
                  }}
                >
                  Cancel
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

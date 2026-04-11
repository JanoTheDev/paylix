"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { DataTable, EmptyState, col } from "@/components/paykit";

type Row = {
  id: string;
  email: string;
  expiresAt: Date;
  status: string;
};

export function PendingInvitesTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  const columns: ColumnDef<Row, unknown>[] = [
    col.text<Row>("email", "Email"),
    col.date<Row>("expiresAt", "Expires"),
    {
      id: "cancel",
      header: () => null,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await authClient.organization.cancelInvitation({
                invitationId: row.original.id,
              });
              router.refresh();
            }}
          >
            Cancel
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyState={
        <EmptyState title="No pending invites" description="All invitations have been accepted or there are none." />
      }
    />
  );
}

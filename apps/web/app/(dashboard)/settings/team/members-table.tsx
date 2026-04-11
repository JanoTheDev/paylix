"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { DataTable, EmptyState, col } from "@/components/paykit";

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

  const columns: ColumnDef<Row, unknown>[] = [
    col.text<Row>("name", "Name"),
    col.text<Row>("email", "Email", { muted: true }),
    col.text<Row>("role", "Role", { muted: true }),
    col.date<Row>("joinedAt", "Joined"),
    ...(canRemove
      ? [
          {
            id: "remove",
            header: () => null,
            cell: ({ row }: { row: { original: Row } }) =>
              row.original.userId !== currentUserId ? (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!confirm(`Remove ${row.original.email}?`)) return;
                      await authClient.organization.removeMember({
                        memberIdOrEmail: row.original.memberId,
                      });
                      router.refresh();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : null,
          } satisfies ColumnDef<Row, unknown>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyState={<EmptyState title="No members" description="No members in this team yet." />}
    />
  );
}

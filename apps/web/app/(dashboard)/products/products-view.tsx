"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  PageShell,
  PageHeader,
  DataTable,
  EmptyState,
  CopyIconButton,
  col,
} from "@/components/paykit";
import { GenerateLinkButton } from "./generate-link-button";

export type ProductRow = {
  id: string;
  name: string;
  type: string;
  billingInterval: string | null;
  state: "active" | "inactive";
};

function formatInterval(interval: string | null): string {
  if (!interval) return "—";
  return interval.charAt(0).toUpperCase() + interval.slice(1);
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const columns = [
  col.text<ProductRow>("name", "Name"),
  {
    id: "productId",
    header: "ID",
    cell: ({ row }: { row: { original: ProductRow } }) => (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-foreground-muted">
          {truncateId(row.original.id)}
        </span>
        <CopyIconButton value={row.original.id} label="Copy product ID" />
      </div>
    ),
  },
  col.status<ProductRow>("type", "Type", "productType"),
  {
    accessorKey: "billingInterval",
    header: "Interval",
    cell: ({ row }: { row: { original: ProductRow } }) => (
      <span className="text-foreground-muted">
        {formatInterval(row.original.billingInterval)}
      </span>
    ),
  },
  col.status<ProductRow>("state", "Status", "productState"),
  col.actions<ProductRow>((row) => (
    <div className="flex items-center gap-1">
      <GenerateLinkButton productId={row.id} />
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/products/${row.id}/edit`}>Edit</Link>
      </Button>
    </div>
  )),
];

interface ProductsViewProps {
  rows: ProductRow[];
}

export default function ProductsView({ rows }: ProductsViewProps) {
  return (
    <PageShell>
      <PageHeader
        title="Products"
        description="The things you sell — one-time or recurring."
        action={
          <Button asChild>
            <Link href="/products/new">Create Product</Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        emptyState={
          <EmptyState
            title="No products yet"
            description="Create your first product to start accepting payments."
            action={
              <Button variant="outline" asChild>
                <Link href="/products/new">Create your first product</Link>
              </Button>
            }
          />
        }
      />
    </PageShell>
  );
}

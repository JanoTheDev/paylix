import type { ColumnDef } from "@tanstack/react-table";
import { Amount } from "./amount";
import { AddressText } from "./address-text";
import { HashText } from "./hash-text";
import { StatusBadge, type StatusKind } from "./status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Align = "left" | "right";

function textCell(value: unknown, align: Align, muted: boolean): ReactNode {
  return (
    <div
      className={cn(
        align === "right" && "text-right",
        muted && "text-foreground-muted",
      )}
    >
      {(value as ReactNode) ?? "—"}
    </div>
  );
}

function networkKeyOf<T>(
  row: T,
  field: keyof T | undefined,
): string | undefined {
  if (!field) return undefined;
  const v = row[field];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const col = {
  text<T>(
    key: keyof T,
    header: string,
    opts: { align?: Align; muted?: boolean } = {},
  ): ColumnDef<T, unknown> {
    const { align = "left", muted = false } = opts;
    return {
      accessorKey: key as string,
      header: () => (
        <div className={align === "right" ? "text-right" : undefined}>
          {header}
        </div>
      ),
      cell: ({ row }) => textCell(row.getValue(key as string), align, muted),
    };
  },

  mono<T>(key: keyof T, header: string): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as string | null | undefined;
        return v ? (
          <span className="font-mono tabular-nums">{v}</span>
        ) : (
          "—"
        );
      },
    };
  },

  /**
   * Integer-cents amount column. `symbolKey` points at the row field holding
   * the settlement token (e.g. `token`, `tokenSymbol`) so the badge doesn't
   * mislabel a DAI or USDT payment as USDC; `symbol` pins it when the whole
   * table is one token.
   */
  amount<T>(
    key: keyof T,
    header: string,
    opts: { withBadge?: boolean; symbol?: string; symbolKey?: keyof T } = {},
  ): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header: () => <div className="text-right">{header}</div>,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as number;
        const fromRow = opts.symbolKey
          ? (row.original[opts.symbolKey] as string | null | undefined)
          : undefined;
        return (
          <Amount
            cents={v}
            withBadge={opts.withBadge}
            symbol={fromRow ?? opts.symbol}
            align="right"
          />
        );
      },
    };
  },

  date<T>(key: keyof T, header: string): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as Date | null | undefined;
        return v ? (
          <span className="text-foreground-muted">{formatDate(v)}</span>
        ) : (
          "—"
        );
      },
    };
  },

  dateTime<T>(key: keyof T, header: string): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as Date | null | undefined;
        return v ? (
          <span className="text-foreground-muted">{formatDateTime(v)}</span>
        ) : (
          "—"
        );
      },
    };
  },

  /**
   * `networkKeyField` points at the row field holding the chain the address
   * lives on, so the explorer link resolves per-row instead of on whatever
   * chain the deployment defaults to.
   */
  address<T>(
    key: keyof T,
    header: string,
    opts: { link?: boolean; networkKeyField?: keyof T } = {},
  ): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as string | null | undefined;
        return v ? (
          <AddressText
            address={v}
            link={opts.link}
            networkKey={networkKeyOf(row.original, opts.networkKeyField)}
          />
        ) : (
          "—"
        );
      },
    };
  },

  hash<T>(
    key: keyof T,
    header: string,
    opts: { explorer?: "tx" | "none"; networkKeyField?: keyof T } = {},
  ): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as string | null | undefined;
        return v ? (
          <HashText
            hash={v}
            link={opts.explorer ?? "tx"}
            networkKey={networkKeyOf(row.original, opts.networkKeyField)}
          />
        ) : (
          "—"
        );
      },
    };
  },

  status<T>(
    key: keyof T,
    header: string,
    kind: StatusKind["kind"],
  ): ColumnDef<T, unknown> {
    return {
      accessorKey: key as string,
      header,
      cell: ({ row }) => {
        const v = row.getValue(key as string) as string;
        // The row value is a DB string; the pairing of `kind` and `status` is
        // guaranteed by the caller, not by the type system. One narrowing
        // cast here keeps `StatusBadge`'s public union strict.
        return <StatusBadge {...({ kind, status: v } as StatusKind)} />;
      },
    };
  },

  customer<T>(opts: {
    emailKey: keyof T;
    walletKey: keyof T;
    header?: string;
  }): ColumnDef<T, unknown> {
    return {
      id: "customer",
      header: opts.header ?? "Customer",
      cell: ({ row }) => {
        const email = row.original[opts.emailKey] as
          | string
          | null
          | undefined;
        const wallet = row.original[opts.walletKey] as
          | string
          | null
          | undefined;
        if (email) return <span>{email}</span>;
        if (wallet) return <AddressText address={wallet} />;
        return <span className="text-foreground-dim">—</span>;
      },
    };
  },

  actions<T>(
    build: (row: T) => ReactNode,
  ): ColumnDef<T, unknown> {
    return {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => (
        <div className="flex justify-end">{build(row.original)}</div>
      ),
    };
  },
};

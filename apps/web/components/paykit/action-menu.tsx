"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

export interface ActionItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  variant?: "default" | "destructive";
  separatorBefore?: boolean;
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionItem[];
  label?: string;
}

export function ActionMenu({ items, label = "Actions" }: ActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-foreground-dim transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={item.onSelect}
              disabled={item.disabled}
              className={cn(
                "gap-2",
                item.variant === "destructive" &&
                  "text-destructive focus:bg-destructive/10 focus:text-destructive",
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

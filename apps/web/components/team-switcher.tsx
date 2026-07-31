"use client";
import { useRouter } from "next/navigation";
import {
  authClient,
  useListOrganizations,
  useActiveOrganization,
} from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ChevronDown, Plus } from "lucide-react";

export function TeamSwitcher() {
  const router = useRouter();
  const { data: orgs } = useListOrganizations();
  const { data: active } = useActiveOrganization();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch team"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{active?.name ?? "No team"}</span>
        <ChevronDown className="h-4 w-4 text-foreground-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 bg-surface-1 border-border shadow-lg">
        {orgs === undefined ? (
          <div className="px-2 py-1.5">
            <Skeleton className="h-4 w-32" />
          </div>
        ) : orgs.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-foreground-muted">
            No teams yet.
          </p>
        ) : (
          orgs.map((o: { id: string; name: string }) => (
            <DropdownMenuItem
              key={o.id}
              onClick={async () => {
                await authClient.organization.setActive({
                  organizationId: o.id,
                });
                router.refresh();
              }}
            >
              <span className="flex-1 truncate">{o.name}</span>
              {active?.id === o.id && (
                <>
                  <Check className="h-4 w-4 text-primary" />
                  <span className="sr-only">(current team)</span>
                </>
              )}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings/team/new")}>
          <Plus className="mr-2 h-4 w-4" />
          Create team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

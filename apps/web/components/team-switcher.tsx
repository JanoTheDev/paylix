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
import { ChevronDown, Plus } from "lucide-react";

export function TeamSwitcher() {
  const router = useRouter();
  const { data: orgs } = useListOrganizations();
  const { data: active } = useActiveOrganization();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-100 hover:bg-slate-900">
        <span className="truncate">{active?.name ?? "No team"}</span>
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {orgs?.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onClick={async () => {
              await authClient.organization.setActive({ organizationId: o.id });
              router.refresh();
            }}
          >
            {o.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings/team/new")}>
          <Plus className="mr-2 h-4 w-4" />
          Create team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

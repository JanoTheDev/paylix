"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";

export function MobileNav({ mode = "test" }: { mode?: "test" | "live" }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation">
            <Menu size={20} />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-60 border-sidebar-border bg-sidebar p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setOpen(false)} mode={mode} />
        </SheetContent>
      </Sheet>
      <span className="text-sm font-semibold tracking-tight">Paylix</span>
      <div className="w-10" />
    </header>
  );
}

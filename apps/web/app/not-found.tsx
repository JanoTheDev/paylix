import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px] rounded-xl border border-border bg-surface-1 p-8 text-center">
        <div className="mb-3 flex justify-center">
          <FileQuestion
            size={40}
            strokeWidth={1.5}
            className="text-foreground-dim"
          />
        </div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="text-sm leading-relaxed text-foreground-muted">
          The page you were looking for doesn&apos;t exist or has moved.
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/overview">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

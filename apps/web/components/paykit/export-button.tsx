"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  href: string;
  label?: string;
}

/**
 * Simple download button. Fetches the CSV with credentials so the
 * dashboard cookie rides along, then triggers a client-side download.
 * Not an <a> tag so we can surface errors via toast instead of
 * silently navigating to an HTML error page.
 */
export function ExportButton({ href, label = "Export CSV" }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "paylix-export.csv";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (res.headers.get("x-paylix-truncated") === "true") {
        toast.warning(
          "Export hit the 50,000-row cap. Narrow your filters for a complete file.",
        );
      } else {
        toast.success("Export downloaded");
      }
    } catch {
      toast.error("Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      <Download className="mr-2 size-4" />
      {loading ? "Exporting…" : label}
    </Button>
  );
}

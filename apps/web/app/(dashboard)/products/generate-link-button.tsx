"use client";

import { useState } from "react";
import { Link2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      aria-label="Copy link"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </Button>
  );
}

export function GenerateLinkButton({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      handleGenerate();
    } else {
      setUrl(null);
      setError(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to generate link");
        return;
      }
      const data = await res.json();
      setUrl(data.url);
    } catch {
      setError("Network error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => handleOpenChange(true)}
        aria-label="Generate checkout link"
        title="Generate checkout link"
      >
        <Link2 size={16} strokeWidth={1.5} />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Checkout Link</DialogTitle>
          <DialogDescription>
            Share this link with customers to accept payment.
          </DialogDescription>
        </DialogHeader>

        {generating && (
          <p className="text-sm text-muted-foreground">Generating...</p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {url && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Checkout URL
            </span>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="flex-1 truncate font-mono text-[13px] text-foreground">
                {url}
              </span>
              <CopyInline text={url} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";

export default function PortalLinkButton({ customerUuid }: { customerUuid: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${base}/portal/${customerUuid}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(148,163,184,0.12)] bg-transparent px-3 text-[12px] font-medium text-[#94a3b8] transition-colors hover:bg-[#111116] hover:text-[#f0f0f3] hover:border-[rgba(148,163,184,0.20)]"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

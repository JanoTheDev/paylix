import { cn } from "@/lib/utils";
import { truncateHash, explorerUrl } from "@/lib/format";
import { networkExplorerUrl } from "./explorer";

interface HashTextProps {
  hash: string;
  link?: "tx" | "none";
  /**
   * Network the transaction landed on (e.g. `base`, `arbitrum-sepolia`).
   * Required for the link to resolve to the right block explorer — without
   * it we fall back to the deployment-wide default.
   */
  networkKey?: string;
  className?: string;
}

export function HashText({
  hash,
  link = "tx",
  networkKey,
  className,
}: HashTextProps) {
  const label = truncateHash(hash);
  const cls = cn(
    "font-mono tabular-nums text-foreground-muted",
    link === "tx" && "transition-colors hover:text-primary",
    className,
  );
  if (link === "tx") {
    return (
      <a
        href={networkExplorerUrl("tx", hash, networkKey) ?? explorerUrl("tx", hash)}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        {label}
      </a>
    );
  }
  return <span className={cls}>{label}</span>;
}

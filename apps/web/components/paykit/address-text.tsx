import { cn } from "@/lib/utils";
import { truncateAddress, explorerUrl } from "@/lib/format";
import { networkExplorerUrl } from "./explorer";

interface AddressTextProps {
  address: string;
  link?: boolean;
  /**
   * Network the address lives on. Required for the link to resolve to the
   * right block explorer — without it we fall back to the deployment-wide
   * default.
   */
  networkKey?: string;
  className?: string;
}

export function AddressText({
  address,
  link,
  networkKey,
  className,
}: AddressTextProps) {
  const label = truncateAddress(address);
  const cls = cn(
    "font-mono tabular-nums text-foreground-muted",
    link && "transition-colors hover:text-primary",
    className,
  );
  if (link) {
    return (
      <a
        href={
          networkExplorerUrl("address", address, networkKey) ??
          explorerUrl("address", address)
        }
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

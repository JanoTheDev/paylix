import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/format";
import { UsdcBadge } from "@/components/usdc-badge";

interface AmountProps {
  /** Integer cents — `1000` is $10.00. Never a float. */
  cents: number;
  withBadge?: boolean;
  /**
   * Token the amount is denominated in. The platform settles in USDC, USDT,
   * DAI, PYUSD, WETH, WBTC, BTC and LTC — labelling every row "USDC" would
   * mislabel the merchant's own ledger.
   */
  symbol?: string;
  align?: "left" | "right";
  className?: string;
}

export function Amount({
  cents,
  withBadge = false,
  symbol = "USDC",
  align = "left",
  className,
}: AmountProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2",
        align === "right" && "justify-end",
        className,
      )}
    >
      <span className="font-mono font-medium tabular-nums">
        {formatAmount(cents)}
      </span>
      {withBadge && <UsdcBadge symbol={symbol} />}
    </div>
  );
}

import { Badge } from "@/components/ui/badge";

/**
 * Token indicator shown alongside an amount.
 *
 * `#2775ca` is USDC's *brand* colour (DESIGN.md §2 Currency: "used exclusively
 * for token indicators... where token identity needs emphasis"), so it is only
 * applied to USDC itself. Every other settlement token — USDT, DAI, PYUSD,
 * WETH, WBTC, BTC, LTC — gets the neutral outline treatment rather than being
 * dressed up as USDC.
 */
export function UsdcBadge({ symbol = "USDC" }: { symbol?: string }) {
  const isUsdc = symbol.toUpperCase() === "USDC";
  return (
    <Badge
      variant={isUsdc ? "usdc" : "outline"}
      className="rounded-md font-mono"
    >
      {symbol}
    </Badge>
  );
}

import { cn } from "@/lib/utils";

// Mirrors `paymentStatusEnum` in packages/db. Refunds are tracked on the
// payment row via refundedCents/refundedAt, not as a status — so there is
// deliberately no "refunded" member here.
type PaymentStatus = "confirmed" | "pending" | "failed";
type SubscriptionStatus =
  | "active"
  | "past_due"
  | "cancelled"
  | "cancelled_in_period"
  | "expired"
  | "incomplete"
  | "trialing"
  | "trial_conversion_failed"
  | "paused";
type ApiKeyStatus = "active" | "revoked";
type WebhookStatus = "active" | "disabled" | "failing";
type ProductType = "one_time" | "subscription";
type ProductState = "active" | "inactive";
type CheckoutStatus =
  | "active"
  | "viewed"
  | "abandoned"
  | "completed"
  | "expired";
type DeliveryStatus = "pending" | "delivered" | "failed";

export type StatusKind =
  | { kind: "payment"; status: PaymentStatus }
  | { kind: "subscription"; status: SubscriptionStatus }
  | { kind: "apiKey"; status: ApiKeyStatus }
  | { kind: "webhook"; status: WebhookStatus }
  | { kind: "productType"; status: ProductType }
  | { kind: "productState"; status: ProductState }
  | { kind: "checkout"; status: CheckoutStatus }
  | { kind: "delivery"; status: DeliveryStatus };

// DESIGN.md §2/§7 — the payment-state palette is fixed and must not be
// re-invented: green = confirmed/active, blue = pending, amber = past_due,
// red = failed/cancelled. Neutral is reserved for states that carry no
// payment semantics at all (inactive, abandoned, disabled).
const SUCCESS = "bg-success/10 text-success ring-success/20";
const PENDING = "bg-info/10 text-info ring-info/20";
const WARNING = "bg-warning/10 text-warning ring-warning/20";
const FAILED = "bg-destructive/10 text-destructive ring-destructive/20";
const NEUTRAL = "bg-surface-2 text-foreground-dim ring-border";

const STYLES: Record<string, string> = {
  confirmed: SUCCESS,
  active: SUCCESS,
  completed: SUCCESS,
  delivered: SUCCESS,
  pending: PENDING,
  incomplete: PENDING,
  one_time: PENDING,
  viewed: PENDING,
  trialing: PENDING,
  paused: PENDING,
  past_due: WARNING,
  failing: WARNING,
  cancelled_in_period: WARNING,
  failed: FAILED,
  revoked: FAILED,
  cancelled: FAILED,
  trial_conversion_failed: FAILED,
  // Expiry is a benign timeout, not a failure — kept neutral deliberately.
  expired: NEUTRAL,
  disabled: NEUTRAL,
  abandoned: NEUTRAL,
  inactive: NEUTRAL,
  subscription: "bg-primary/10 text-primary ring-primary/20",
};

const LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  failed: "Failed",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  cancelled_in_period: "Cancels at period end",
  expired: "Expired",
  incomplete: "Incomplete",
  revoked: "Revoked",
  disabled: "Disabled",
  failing: "Failing",
  one_time: "One-time",
  subscription: "Subscription",
  inactive: "Inactive",
  viewed: "Viewed",
  abandoned: "Abandoned",
  completed: "Completed",
  delivered: "Delivered",
  trialing: "Trial",
  trial_conversion_failed: "Trial failed",
  paused: "Paused",
};

export function StatusBadge(props: StatusKind) {
  const { status } = props;
  return (
    <span
      className={cn(
        // DESIGN.md §4 Badges: full pill, 11px / weight 600 / 0.3px tracking.
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.3px] whitespace-nowrap ring-1 ring-inset",
        STYLES[status] ?? NEUTRAL,
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}

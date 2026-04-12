import { cn } from "@/lib/utils";

type PaymentStatus = "confirmed" | "pending" | "failed" | "refunded";
type SubscriptionStatus =
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "incomplete"
  | "trialing"
  | "trial_conversion_failed";
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

type StatusKind =
  | { kind: "payment"; status: PaymentStatus }
  | { kind: "subscription"; status: SubscriptionStatus }
  | { kind: "apiKey"; status: ApiKeyStatus }
  | { kind: "webhook"; status: WebhookStatus }
  | { kind: "productType"; status: ProductType }
  | { kind: "productState"; status: ProductState }
  | { kind: "checkout"; status: CheckoutStatus }
  | { kind: "delivery"; status: DeliveryStatus };

const STYLES: Record<string, string> = {
  confirmed: "bg-success/10 text-success ring-success/20",
  active: "bg-success/10 text-success ring-success/20",
  pending: "bg-info/10 text-info ring-info/20",
  incomplete: "bg-info/10 text-info ring-info/20",
  one_time: "bg-info/10 text-info ring-info/20",
  past_due: "bg-warning/10 text-warning ring-warning/20",
  failing: "bg-warning/10 text-warning ring-warning/20",
  failed: "bg-destructive/10 text-destructive ring-destructive/20",
  revoked: "bg-destructive/10 text-destructive ring-destructive/20",
  cancelled: "bg-surface-2 text-foreground-dim ring-border",
  expired: "bg-surface-2 text-foreground-dim ring-border",
  disabled: "bg-surface-2 text-foreground-dim ring-border",
  refunded: "bg-surface-2 text-foreground-dim ring-border",
  abandoned: "bg-surface-2 text-foreground-dim ring-border",
  inactive: "bg-surface-2 text-foreground-dim ring-border",
  viewed: "bg-info/10 text-info ring-info/20",
  completed: "bg-success/10 text-success ring-success/20",
  delivered: "bg-success/10 text-success ring-success/20",
  subscription: "bg-primary/10 text-primary ring-primary/20",
  trialing: "bg-info/10 text-info ring-info/20",
  trial_conversion_failed: "bg-destructive/10 text-destructive ring-destructive/20",
};

const LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  failed: "Failed",
  refunded: "Refunded",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
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
};

export function StatusBadge(props: StatusKind) {
  const { status } = props;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STYLES[status] ?? "bg-surface-2 text-foreground-muted ring-border",
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}

import type { Metadata } from "next";
import {
  CodeBlock,
  DocTable,
  DocTableBody,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  ParamRow,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Coupons — SDK Reference" };

export default function CouponsReference() {
  return (
    <>
      <PageHeading
        title="Coupons"
        description="Create, list, archive, apply, and remove discount codes on checkout sessions."
      />

      <SectionHeading>paylix.createCoupon(params)</SectionHeading>
      <CodeBlock language="ts">{`paylix.createCoupon({
  code: "SPRING25",
  type: "percent",       // or "fixed"
  percentOff: 25,        // when type = "percent"
  // amountOffCents: 500, // when type = "fixed"
  duration: "once",      // "once" | "forever" | "repeating"
  // durationInCycles: 3, // when duration = "repeating"
  maxRedemptions: 100,
});`}</CodeBlock>

      <SubsectionHeading>Coupon</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="id" type="string" description="Coupon ID." />
          <ParamRow name="code" type="string" description="Case-sensitive code buyers enter at checkout — it is stored exactly as you create it." />
          <ParamRow name="type" type='"percent" | "fixed"' description="Discount type." />
          <ParamRow name="percentOff" type="number | null" description="Percent off (1–100) for percent coupons." />
          <ParamRow name="amountOffCents" type="number | null" description="Integer cents off for fixed coupons." />
          <ParamRow name="duration" type='"once" | "forever" | "repeating"' description="How many cycles the coupon applies for on subscriptions." />
          <ParamRow name="durationInCycles" type="number | null" description="Number of cycles when duration is 'repeating'." />
          <ParamRow name="maxRedemptions" type="number | null" description="Hard cap on total uses. Null = unlimited." />
          <ParamRow name="redemptionCount" type="number" description="Redemptions so far." />
          <ParamRow name="isActive" type="boolean" description="Whether the coupon is currently redeemable." />
        </DocTableBody>
      </DocTable>

      <SectionHeading>paylix.listCoupons()</SectionHeading>
      <CodeBlock language="ts">{`paylix.listCoupons(): Promise<Coupon[]>`}</CodeBlock>

      <SectionHeading>paylix.archiveCoupon(id)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Soft-archives a coupon (sets <code>isActive: false</code>). Existing
        redemption rows remain for auditability.
      </p>
      <CodeBlock language="ts">{`paylix.archiveCoupon("cou_..."): Promise<void>`}</CodeBlock>

      <SectionHeading>paylix.applyCouponToCheckout(sessionId, code)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Server-side apply. Useful when you host your own checkout UI.
        Mutates <code>session.amount</code> and records the original on{" "}
        <code>subtotalAmount</code>. The discount comes back as{" "}
        <code>discountCents</code> — a number in integer cents (500 = $5.00
        off). Only <code>amount</code> and <code>subtotalAmount</code> are
        decimal strings in the token&apos;s native units.
      </p>
      <CodeBlock language="ts">{`const r = await paylix.applyCouponToCheckout("chk_...", "SPRING25");
console.log(r.discountCents, r.amount, r.subtotalAmount);`}</CodeBlock>

      <SectionHeading>paylix.removeCouponFromCheckout(sessionId)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Clears the applied coupon from a session and restores the
        pre-discount amount.
      </p>
      <CodeBlock language="ts">{`paylix.removeCouponFromCheckout("chk_..."): Promise<void>`}</CodeBlock>
    </>
  );
}

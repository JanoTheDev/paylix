/**
 * Deterministic payload fixtures for every webhook event type. Used by
 * the "Send test event" dashboard action so merchants can verify an
 * endpoint without triggering a real payment.
 *
 * Every fixture gets an `event_id: "evt_test_*"` marker and `livemode:
 * false` so receivers can safely filter test traffic out of their
 * production handlers.
 */

export const WEBHOOK_EVENT_TYPES = [
  "payment.confirmed",
  "subscription.created",
  "subscription.charged",
  "subscription.past_due",
  "subscription.cancelled",
  "subscription.trial_started",
  "subscription.trial_ending",
  "subscription.trial_converted",
  "subscription.trial_cancelled",
  "invoice.issued",
  "invoice.email_sent",
  "invoice.email_failed",
  "coupon.redeemed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isKnownEventType(v: string): v is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(v);
}

/**
 * Returns the data payload (envelope goes around this). Values are
 * stable so repeated test sends compare byte-identical.
 */
export function fixtureDataFor(event: WebhookEventType): Record<string, unknown> {
  switch (event) {
    case "payment.confirmed":
      return {
        paymentId: "pay_test_0000000000000000",
        checkoutSessionId: "chk_test_0000000000000000",
        amount: 1000,
        currency: "USDC",
        chain: "base",
        txHash: "0xtest0000000000000000000000000000000000000000000000000000000000",
        fromAddress: "0x1111111111111111111111111111111111111111",
        toAddress: "0x2222222222222222222222222222222222222222",
        metadata: { orderId: "test-order" },
      };
    case "subscription.created":
      return {
        subscriptionId: "sub_test_0000000000000000",
        onChainId: "1",
        productId: "prod_test",
        customerId: "cust_test",
        amount: 1000,
        currency: "USDC",
        chain: "base",
        interval: 2_592_000,
        subscriberAddress: "0x1111111111111111111111111111111111111111",
        merchantAddress: "0x2222222222222222222222222222222222222222",
        metadata: { plan: "pro" },
      };
    case "subscription.charged":
      return {
        subscriptionId: "sub_test_0000000000000000",
        onChainId: "1",
        paymentId: "pay_test_charge",
        amount: 1000,
        fee: 5,
        txHash: "0xtest1111111111111111111111111111111111111111111111111111111111",
        nextChargeDate: "2026-05-22T00:00:00.000Z",
        metadata: { plan: "pro" },
      };
    case "subscription.past_due":
      return {
        subscriptionId: "sub_test_0000000000000000",
        onChainId: "1",
        status: "past_due",
        metadata: { plan: "pro" },
      };
    case "subscription.cancelled":
      return {
        subscriptionId: "sub_test_0000000000000000",
        onChainId: "1",
        status: "cancelled",
        metadata: { plan: "pro" },
      };
    case "subscription.trial_started":
      return {
        subscriptionId: "sub_test_0000000000000000",
        checkoutId: "chk_test",
        productId: "prod_test",
        customerId: "cust_test",
        subscriberAddress: "0x1111111111111111111111111111111111111111",
        trialEndsAt: "2026-04-29T00:00:00.000Z",
        metadata: {},
      };
    case "subscription.trial_ending":
      return {
        subscriptionId: "sub_test_0000000000000000",
        productId: "prod_test",
        customerId: "cust_test",
        subscriberAddress: "0x1111111111111111111111111111111111111111",
        trialEndsAt: "2026-04-25T00:00:00.000Z",
        metadata: {},
      };
    case "subscription.trial_converted":
      return {
        subscriptionId: "sub_test_0000000000000000",
        onChainId: "1",
        subscriberAddress: "0x1111111111111111111111111111111111111111",
        merchantAddress: "0x2222222222222222222222222222222222222222",
        txHash: "0xtest2222222222222222222222222222222222222222222222222222222222",
      };
    case "subscription.trial_cancelled":
      return {
        subscriptionId: "sub_test_0000000000000000",
        productId: "prod_test",
        customerId: "cust_test",
        subscriberAddress: "0x1111111111111111111111111111111111111111",
        trialEndsAt: "2026-04-29T00:00:00.000Z",
        cancelledBy: "customer",
        cancelledAt: "2026-04-22T12:00:00.000Z",
        metadata: {},
      };
    case "invoice.issued":
      return {
        invoiceId: "inv_test_0000000000000000",
        number: "INV-TEST-001",
        paymentId: "pay_test_0000000000000000",
        customerId: "cust_test",
        totalCents: 1200,
        currency: "USDC",
        hostedUrl: "/i/test",
      };
    case "invoice.email_sent":
      return {
        invoiceId: "inv_test_0000000000000000",
        to: "test@example.com",
      };
    case "invoice.email_failed":
      return {
        invoiceId: "inv_test_0000000000000000",
        to: "test@example.com",
        error: "test failure",
      };
    case "coupon.redeemed":
      return {
        couponId: "cou_test_0000000000000000",
        checkoutSessionId: "chk_test_0000000000000000",
        discountCents: 250,
        amount: "750",
        subtotalAmount: "1000",
        metadata: { plan: "pro" },
      };
  }
}

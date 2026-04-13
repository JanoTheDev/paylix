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

export const metadata: Metadata = { title: "Checkout & Verification — SDK Reference" };

export default function CheckoutReference() {
  return (
    <>
      <PageHeading
        title="Checkout & Verification"
        description="Create checkout sessions and verify payments on-chain."
      />

      <SectionHeading>paylix.createCheckout()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Creates a one-time payment checkout session.
      </p>
      <CodeBlock language="ts">{`paylix.createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult>`}</CodeBlock>

      <SubsectionHeading>Parameters</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Parameter</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="productId" type="string" required description="ID of the product to charge for." />
          <ParamRow name="customerId" type="string" description="Your customer identifier." />
          <ParamRow name="successUrl" type="string" description="Redirect URL after successful payment." />
          <ParamRow name="cancelUrl" type="string" description="Redirect URL if the customer cancels." />
          <ParamRow name="metadata" type="Record<string, string>" description="Arbitrary key-value data attached to the checkout." />
        </DocTableBody>
      </DocTable>

      <SubsectionHeading>Returns</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="checkoutUrl" type="string" description="Hosted checkout page URL. Redirect the customer here." />
          <ParamRow name="checkoutId" type="string" description="Unique identifier for this checkout session." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const { checkoutUrl, checkoutId } = await paylix.createCheckout({
  productId: "prod_abc123",
  customerId: "cust_xyz",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
  metadata: { orderId: "42" },
});`}</CodeBlock>

      <SectionHeading>paylix.verifyPayment()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Verifies a payment&apos;s status and returns transaction details. Always
        verify server-side before fulfilling orders.
      </p>
      <CodeBlock language="ts">{`paylix.verifyPayment(params: { paymentId: string }): Promise<VerifyPaymentResult>`}</CodeBlock>

      <SubsectionHeading>Returns</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="verified" type="boolean" description="Whether the payment is confirmed on-chain." />
          <ParamRow name="amount" type="number" description="Payment amount in USDC (integer cents, e.g. 1000 = $10.00)." />
          <ParamRow name="fee" type="number" description="Platform fee in USDC cents." />
          <ParamRow name="txHash" type="string" description="On-chain transaction hash." />
          <ParamRow name="chain" type="string" description={`Network the payment was made on (e.g. "base").`} />
          <ParamRow name="customerId" type="string" description="Customer identifier." />
          <ParamRow name="productId" type="string" description="Product identifier." />
          <ParamRow name="status" type="string" description={`Payment status: "confirmed", "pending", or "failed".`} />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const result = await paylix.verifyPayment({
  paymentId: "pay_abc123",
});

if (result.verified) {
  console.log("Confirmed:", result.txHash);
  console.log("Amount:", result.amount / 100, "USDC");
}`}</CodeBlock>
    </>
  );
}

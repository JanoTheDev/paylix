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

export const metadata: Metadata = { title: "Payments — SDK Reference" };

export default function PaymentsReference() {
  return (
    <>
      <PageHeading
        title="Payments"
        description="List and retrieve payment records with filtering and customer info."
      />

      <SectionHeading>paylix.listPayments()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Lists payments for the authenticated organization. Supports filtering
        by customer ID, payment status, and metadata key-value pairs. Returns
        up to 100 results, ordered by creation date (newest first). Every
        result includes an embedded{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          customer
        </code>{" "}
        object with the customer&apos;s email, name, and wallet.
      </p>
      <CodeBlock language="ts">{`paylix.listPayments(params?: ListPaymentsParams): Promise<PaymentSummary[]>`}</CodeBlock>

      <SubsectionHeading>Filter Parameters</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Parameter</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="customerId" type="string" description="Filter by customer ID (the Paylix-generated identifier)." />
          <ParamRow name="status" type={`"pending" | "confirmed" | "failed"`} description="Filter by payment status." />
          <ParamRow name="metadata" type="Record<string, string>" description="Filter by metadata key-value pairs. Only payments whose metadata contains all specified entries are returned (AND logic)." />
          <ParamRow name="limit" type="number" description="Max results (1-100, default 100)." />
        </DocTableBody>
      </DocTable>

      <SubsectionHeading>PaymentSummary</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="id" type="string" description="Payment ID." />
          <ParamRow name="amount" type="number" description="Payment amount in token units (e.g. 1000 = 10.00 USDC)." />
          <ParamRow name="fee" type="number" description="Platform fee in token units." />
          <ParamRow name="status" type={`"pending" | "confirmed" | "failed"`} description="Current payment status." />
          <ParamRow name="txHash" type="string | null" description="On-chain transaction hash." />
          <ParamRow name="chain" type="string" description="Network the payment was made on." />
          <ParamRow name="token" type="string" description="Token symbol (e.g. USDC)." />
          <ParamRow name="productId" type="string" description="Product identifier." />
          <ParamRow name="fromAddress" type="string | null" description="Sender wallet address." />
          <ParamRow name="toAddress" type="string | null" description="Recipient (merchant) wallet address." />
          <ParamRow name="metadata" type="Record<string, string>" description="Custom key-value metadata (merged from checkout and payment)." />
          <ParamRow name="livemode" type="boolean" description="Whether this is a live-mode payment." />
          <ParamRow name="createdAt" type="string" description="ISO-8601 creation timestamp." />
          <ParamRow name="customer" type="CustomerInfo" description="Embedded customer: id, email, firstName, lastName, walletAddress." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`// List all payments
const payments = await paylix.listPayments();

// Filter by customer
const customerPayments = await paylix.listPayments({
  customerId: "cust_xyz",
});

// Search by metadata — find all payments for a specific user in your system
const userPayments = await paylix.listPayments({
  metadata: { userId: "user_123" },
});

// Combine filters
const confirmedOrders = await paylix.listPayments({
  customerId: "cust_xyz",
  status: "confirmed",
  metadata: { orderId: "42" },
});

// Access customer info from results
for (const p of payments) {
  console.log(p.id, p.amount, p.customer.email, p.customer.walletAddress);
}`}</CodeBlock>

      <SectionHeading>paylix.getPayment()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Retrieves a single payment by ID, including the embedded customer object.
      </p>
      <CodeBlock language="ts">{`paylix.getPayment(id: string): Promise<PaymentSummary>`}</CodeBlock>
      <CodeBlock language="ts">{`const payment = await paylix.getPayment("pay_abc123");
console.log(payment.status, payment.txHash);
console.log("Customer:", payment.customer.email);`}</CodeBlock>
    </>
  );
}

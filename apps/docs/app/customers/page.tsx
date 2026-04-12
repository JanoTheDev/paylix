import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Customer Management" };

export default function CustomersPage() {
  return (
    <>
      <PageHeading
        title="Customer Management"
        description="Customers are created automatically on first checkout or manually via the SDK. Manage them from the dashboard, the API, or the customer portal."
      />

      <SectionHeading>Overview</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        A customer record is created the first time someone completes a
        checkout. You can also create customers ahead of time via the SDK or
        dashboard. Each customer has a unique ID, optional contact fields, and
        a wallet address linked at checkout.
      </p>

      <SectionHeading>Fields</SectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            customerId
          </code>{" "}
          — unique identifier
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            email
          </code>{" "}
          — email address
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            firstName
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            lastName
          </code>{" "}
          — name fields
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            phone
          </code>{" "}
          — phone number
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            walletAddress
          </code>{" "}
          — linked wallet
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            metadata
          </code>{" "}
          — arbitrary key-value data
        </li>
      </ul>

      <SectionHeading>SDK methods</SectionHeading>

      <SubsectionHeading>Create a customer</SubsectionHeading>
      <CodeBlock language="ts">{`const customer = await paylix.createCustomer({
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Smith",
});`}</CodeBlock>

      <SubsectionHeading>Get a customer</SubsectionHeading>
      <CodeBlock language="ts">{`const customer = await paylix.getCustomer("cust_abc123");`}</CodeBlock>

      <SubsectionHeading>Update a customer</SubsectionHeading>
      <CodeBlock language="ts">{`const updated = await paylix.updateCustomer("cust_abc123", {
  phone: "+1-555-0199",
  metadata: { plan: "enterprise" },
});`}</CodeBlock>

      <SubsectionHeading>List customers</SubsectionHeading>
      <CodeBlock language="ts">{`const { customers } = await paylix.listCustomers();`}</CodeBlock>

      <SubsectionHeading>Delete a customer</SubsectionHeading>
      <CodeBlock language="ts">{`await paylix.deleteCustomer("cust_abc123");`}</CodeBlock>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Delete is a soft delete — it sets{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          deletedAt
        </code>{" "}
        on the customer record. The customer disappears from lists and search
        results, but all payment and subscription history is preserved for
        accounting.
      </p>

      <SectionHeading>Dashboard</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The Customers page shows all customers with name, email, wallet
        address, total spent, and payment count. Click a customer to see their
        detail view, which includes payments, subscriptions, and invoices. The
        delete button performs a soft delete.
      </p>

      <SectionHeading>Customer portal</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Generate a portal session URL via{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          createPortalSession
        </code>{" "}
        to give customers self-service access. The portal lets customers view
        their payments and subscriptions, cancel trials, and download invoices.
      </p>
      <CodeBlock language="ts">{`const { url } = await paylix.createPortalSession({
  customerId: "cust_abc123",
  returnUrl: "https://example.com/account",
});

// Redirect the customer to url`}</CodeBlock>
    </>
  );
}

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

export const metadata: Metadata = { title: "Webhook Management — SDK Reference" };

export default function WebhooksReference() {
  return (
    <>
      <PageHeading
        title="Webhook Management"
        description="Create, list, update, and delete webhook endpoints. Verify incoming webhook signatures."
      />

      <SectionHeading>paylix.listWebhooks()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Lists all webhook endpoints for the authenticated organization.
      </p>
      <CodeBlock language="ts">{`paylix.listWebhooks(): Promise<Webhook[]>`}</CodeBlock>

      <SubsectionHeading>Webhook</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="id" type="string" description="Webhook endpoint ID." />
          <ParamRow name="url" type="string" description="Destination URL." />
          <ParamRow name="events" type="string[]" description="Event types this endpoint subscribes to." />
          <ParamRow name="isActive" type="boolean" description="Whether the endpoint is currently active." />
          <ParamRow name="livemode" type="boolean" description="Whether this is a live-mode webhook." />
          <ParamRow name="createdAt" type="string" description="ISO-8601 creation timestamp." />
          <ParamRow name="secret" type="string" description="Signing secret (only returned on creation)." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const hooks = await paylix.listWebhooks();
hooks.forEach(h => console.log(h.url, h.isActive ? "✓" : "✗"));`}</CodeBlock>

      <SectionHeading>paylix.createWebhook()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Creates a new webhook endpoint. The response includes the{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          secret
        </code>{" "}
        — store it securely, as it is only returned once.
      </p>
      <CodeBlock language="ts">{`paylix.createWebhook(params: {
  url: string;
  events: string[];
}): Promise<Webhook>`}</CodeBlock>

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
          <ParamRow name="url" type="string" required description="HTTPS URL that will receive webhook POSTs." />
          <ParamRow name="events" type="string[]" required description={`Array of event types to subscribe to (e.g. ["payment.confirmed", "subscription.created"]).`} />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`const hook = await paylix.createWebhook({
  url: "https://example.com/webhooks/paylix",
  events: ["payment.confirmed", "subscription.created", "subscription.cancelled"],
});

// Save this — it's only returned once
console.log("Webhook secret:", hook.secret);`}</CodeBlock>

      <SectionHeading>paylix.getWebhook()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Retrieves a single webhook endpoint by ID.
      </p>
      <CodeBlock language="ts">{`paylix.getWebhook(id: string): Promise<Webhook>`}</CodeBlock>
      <CodeBlock language="ts">{`const hook = await paylix.getWebhook("wh_abc123");
console.log(hook.url, hook.events);`}</CodeBlock>

      <SectionHeading>paylix.updateWebhook()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Updates a webhook endpoint. All fields are optional — only provide
        the ones you want to change.
      </p>
      <CodeBlock language="ts">{`paylix.updateWebhook(id: string, params: {
  url?: string;
  events?: string[];
  isActive?: boolean;
}): Promise<Webhook>`}</CodeBlock>

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
          <ParamRow name="url" type="string" description="New destination URL." />
          <ParamRow name="events" type="string[]" description="Replace subscribed event types." />
          <ParamRow name="isActive" type="boolean" description="Enable or disable the endpoint." />
        </DocTableBody>
      </DocTable>

      <CodeBlock language="ts">{`// Disable a webhook endpoint
await paylix.updateWebhook("wh_abc123", { isActive: false });

// Change the URL and subscribed events
await paylix.updateWebhook("wh_abc123", {
  url: "https://example.com/webhooks/v2",
  events: ["payment.confirmed"],
});`}</CodeBlock>

      <SectionHeading>paylix.deleteWebhook()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Permanently deletes a webhook endpoint. Events will no longer be
        delivered to this URL.
      </p>
      <CodeBlock language="ts">{`paylix.deleteWebhook(id: string): Promise<{ success: true }>`}</CodeBlock>
      <CodeBlock language="ts">{`await paylix.deleteWebhook("wh_abc123");`}</CodeBlock>

      <SectionHeading>webhooks.verify()</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Verifies a webhook signature to ensure the event was sent by Paylix.
        Import{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          webhooks
        </code>{" "}
        directly from the SDK — this is a standalone utility, not a method on
        the Paylix class.
      </p>
      <CodeBlock language="ts">{`webhooks.verify(params: {
  payload: string;
  signature: string;
  secret: string;
}): boolean`}</CodeBlock>
      <CodeBlock language="ts">{`import { webhooks } from "@paylix/sdk";

const isValid = webhooks.verify({
  payload: rawBody,
  signature: req.headers["x-paylix-signature"],
  secret: process.env.PAYLIX_WEBHOOK_SECRET!,
});`}</CodeBlock>
    </>
  );
}

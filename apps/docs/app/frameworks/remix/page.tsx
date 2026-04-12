import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Remix" };

export default function Remix() {
  return (
    <>
      <PageHeading
        title="Remix"
        description="Integrate Paylix in Remix using loaders and actions. Any .server.ts file is guaranteed to stay out of client bundles."
      />

      <SectionHeading>1. Install</SectionHeading>
      <CodeBlock language="bash">{`npm install @paylix/sdk`}</CodeBlock>

      <SectionHeading>2. Environment variables</SectionHeading>
      <CodeBlock language="bash" filename=".env">{`PAYLIX_SECRET_KEY=sk_live_...
PAYLIX_WEBHOOK_SECRET=whsec_...
PAYLIX_URL=https://your-paylix-instance.com
APP_URL=https://yourapp.com`}</CodeBlock>

      <SectionHeading>3. File structure</SectionHeading>
      <CodeBlock language="bash">{`app/
  lib/
    paylix.server.ts                # SDK instance (server-only)
  routes/
    _index.tsx                      # landing page
    checkout.tsx                    # action creates session, redirects
    api.webhooks.paylix.tsx         # action handles webhook events
    success.tsx                     # post-payment`}</CodeBlock>

      <SectionHeading>4. SDK instance</SectionHeading>
      <CodeBlock language="ts" filename="app/lib/paylix.server.ts">{`import { Paylix } from "@paylix/sdk";

export const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});`}</CodeBlock>

      <SectionHeading>5. Checkout action</SectionHeading>
      <CodeBlock language="ts" filename="app/routes/checkout.tsx">{`import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form } from "@remix-run/react";
import { paylix } from "~/lib/paylix.server";

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const productId = form.get("productId") as string;

  const { checkoutUrl } = await paylix.createCheckout({
    productId,
    successUrl: \`\${process.env.APP_URL}/success\`,
    cancelUrl: \`\${process.env.APP_URL}/checkout\`,
  });

  return redirect(checkoutUrl);
}

export default function Checkout() {
  return (
    <div>
      <h1>Choose a plan</h1>
      <Form method="post">
        <input type="hidden" name="productId" value="prod_starter" />
        <button type="submit">Starter — $10/mo</button>
      </Form>
      <Form method="post">
        <input type="hidden" name="productId" value="prod_pro" />
        <button type="submit">Pro — $25/mo</button>
      </Form>
    </div>
  );
}`}</CodeBlock>

      <SectionHeading>6. Handle webhooks</SectionHeading>
      <CodeBlock language="ts" filename="app/routes/api.webhooks.paylix.tsx">{`import { json, type ActionFunctionArgs } from "@remix-run/node";
import { webhooks } from "@paylix/sdk";

export async function action({ request }: ActionFunctionArgs) {
  const payload = await request.text();
  const signature = request.headers.get("x-paylix-signature")!;

  const valid = webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  });

  if (!valid) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(payload);

  switch (event.type) {
    case "payment.confirmed":
      // fulfill order
      break;
    case "subscription.created":
      // activate subscription
      break;
  }

  return json({ received: true });
}`}</CodeBlock>
    </>
  );
}

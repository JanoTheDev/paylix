import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "SvelteKit" };

export default function SvelteKit() {
  return (
    <>
      <PageHeading
        title="SvelteKit"
        description="Integrate Paylix in SvelteKit using form actions and server endpoints. The SDK lives in $lib/server so it's only available server-side."
      />

      <SectionHeading>1. Install</SectionHeading>
      <CodeBlock language="bash">{`npm install @paylix/sdk`}</CodeBlock>

      <SectionHeading>2. Environment variables</SectionHeading>
      <CodeBlock language="bash" filename=".env">{`PAYLIX_SECRET_KEY=sk_live_...
PAYLIX_WEBHOOK_SECRET=whsec_...
PAYLIX_URL=https://your-paylix-instance.com
PUBLIC_NETWORK=base`}</CodeBlock>

      <SectionHeading>3. File structure</SectionHeading>
      <CodeBlock language="bash">{`src/
  lib/
    server/
      paylix.ts                     # SDK instance (server-only)
  routes/
    +page.svelte                    # landing page
    checkout/
      +page.svelte                  # pricing / checkout trigger
      +page.server.ts               # form action — creates session
    api/
      webhooks/
        paylix/
          +server.ts                # POST — receives webhook events
    success/
      +page.svelte                  # post-payment page`}</CodeBlock>

      <SectionHeading>4. SDK instance</SectionHeading>
      <CodeBlock language="ts" filename="src/lib/server/paylix.ts">{`import { Paylix } from "@paylix/sdk";
import { PAYLIX_SECRET_KEY, PAYLIX_URL } from "$env/static/private";
import { PUBLIC_NETWORK } from "$env/static/public";

export const paylix = new Paylix({
  apiKey: PAYLIX_SECRET_KEY,
  network: PUBLIC_NETWORK === "base" ? "base" : "base-sepolia",
  backendUrl: PAYLIX_URL,
});`}</CodeBlock>

      <SectionHeading>5. Checkout form action</SectionHeading>
      <CodeBlock language="ts" filename="src/routes/checkout/+page.server.ts">{`import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { paylix } from "$lib/server/paylix";

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const productId = form.get("productId") as string;

    const { checkoutUrl } = await paylix.createCheckout({
      productId,
      successUrl: "https://yourapp.com/success",
      cancelUrl: "https://yourapp.com/checkout",
    });

    throw redirect(303, checkoutUrl);
  },
};`}</CodeBlock>

      <SectionHeading>6. Checkout page</SectionHeading>
      <CodeBlock language="ts" filename="src/routes/checkout/+page.svelte">{`<script>
  import { enhance } from "$app/forms";
</script>

<h1>Choose a plan</h1>

<form method="POST" use:enhance>
  <input type="hidden" name="productId" value="prod_starter" />
  <button type="submit">Starter — $10/mo</button>
</form>

<form method="POST" use:enhance>
  <input type="hidden" name="productId" value="prod_pro" />
  <button type="submit">Pro — $25/mo</button>
</form>`}</CodeBlock>

      <SectionHeading>7. Handle webhooks</SectionHeading>
      <CodeBlock language="ts" filename="src/routes/api/webhooks/paylix/+server.ts">{`import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { webhooks } from "@paylix/sdk";
import { PAYLIX_WEBHOOK_SECRET } from "$env/static/private";

export const POST: RequestHandler = async ({ request }) => {
  const payload = await request.text();
  const signature = request.headers.get("x-paylix-signature")!;

  const valid = webhooks.verify({
    payload,
    signature,
    secret: PAYLIX_WEBHOOK_SECRET,
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
};`}</CodeBlock>
    </>
  );
}

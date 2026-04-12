import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Nuxt 3" };

export default function Nuxt() {
  return (
    <>
      <PageHeading
        title="Nuxt 3"
        description="Integrate Paylix in Nuxt 3 using server/api routes. The SDK instance is exposed via a server util so every route can import it."
      />

      <SectionHeading>1. Install</SectionHeading>
      <CodeBlock language="bash">{`npm install @paylix/sdk`}</CodeBlock>

      <SectionHeading>2. Runtime config</SectionHeading>
      <CodeBlock language="ts" filename="nuxt.config.ts">{`export default defineNuxtConfig({
  runtimeConfig: {
    paylixSecretKey: process.env.PAYLIX_SECRET_KEY,
    paylixWebhookSecret: process.env.PAYLIX_WEBHOOK_SECRET,
    paylixUrl: process.env.PAYLIX_URL,
    public: {
      network: process.env.NUXT_PUBLIC_NETWORK ?? "base",
      appUrl: process.env.NUXT_PUBLIC_APP_URL,
    },
  },
});`}</CodeBlock>

      <SectionHeading>3. Environment variables</SectionHeading>
      <CodeBlock language="bash" filename=".env">{`PAYLIX_SECRET_KEY=sk_live_...
PAYLIX_WEBHOOK_SECRET=whsec_...
PAYLIX_URL=https://your-paylix-instance.com
NUXT_PUBLIC_NETWORK=base
NUXT_PUBLIC_APP_URL=https://yourapp.com`}</CodeBlock>

      <SectionHeading>4. File structure</SectionHeading>
      <CodeBlock language="bash">{`server/
  utils/
    paylix.ts                       # SDK instance (auto-imported)
  api/
    checkout.post.ts                # POST /api/checkout
    webhooks/
      paylix.post.ts                # POST /api/webhooks/paylix
pages/
  index.vue                         # landing page
  checkout.vue                      # pricing page
  success.vue                       # post-payment
nuxt.config.ts`}</CodeBlock>

      <SectionHeading>5. SDK instance</SectionHeading>
      <CodeBlock language="ts" filename="server/utils/paylix.ts">{`import { Paylix } from "@paylix/sdk";

let _paylix: Paylix | null = null;

export function usePaylix() {
  if (_paylix) return _paylix;
  const config = useRuntimeConfig();
  _paylix = new Paylix({
    apiKey: config.paylixSecretKey,
    network: config.public.network === "base" ? "base" : "base-sepolia",
    backendUrl: config.paylixUrl,
  });
  return _paylix;
}`}</CodeBlock>

      <SectionHeading>6. Create checkout</SectionHeading>
      <CodeBlock language="ts" filename="server/api/checkout.post.ts">{`export default defineEventHandler(async (event) => {
  const { productId, customerId } = await readBody(event);
  const config = useRuntimeConfig();
  const paylix = usePaylix();

  const { checkoutUrl, checkoutId } = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${config.public.appUrl}/success\`,
    cancelUrl: \`\${config.public.appUrl}/checkout\`,
  });

  return { checkoutUrl, checkoutId };
});`}</CodeBlock>

      <SectionHeading>7. Handle webhooks</SectionHeading>
      <CodeBlock language="ts" filename="server/api/webhooks/paylix.post.ts">{`import { webhooks } from "@paylix/sdk";

export default defineEventHandler(async (event) => {
  const payload = await readRawBody(event);
  const signature = getHeader(event, "x-paylix-signature")!;
  const config = useRuntimeConfig();

  const valid = webhooks.verify({
    payload: payload!,
    signature,
    secret: config.paylixWebhookSecret,
  });

  if (!valid) {
    throw createError({ statusCode: 401, message: "Invalid signature" });
  }

  const parsed = JSON.parse(payload!);

  switch (parsed.type) {
    case "payment.confirmed":
      // fulfill order
      break;
    case "subscription.created":
      // activate subscription
      break;
  }

  return { received: true };
});`}</CodeBlock>

      <SectionHeading>8. Vue page</SectionHeading>
      <CodeBlock language="ts" filename="pages/checkout.vue">{`<script setup lang="ts">
async function checkout(productId: string) {
  const { checkoutUrl } = await $fetch("/api/checkout", {
    method: "POST",
    body: { productId },
  });
  navigateTo(checkoutUrl, { external: true });
}
</script>

<template>
  <div>
    <h1>Choose a plan</h1>
    <button @click="checkout('prod_starter')">Starter — $10/mo</button>
    <button @click="checkout('prod_pro')">Pro — $25/mo</button>
  </div>
</template>`}</CodeBlock>
    </>
  );
}

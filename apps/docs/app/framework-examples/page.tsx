import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Framework Examples" };

export default function FrameworkExamples() {
  return (
    <>
      <PageHeading
        title="Framework Examples"
        description="Full integration examples showing how to use @paylix/sdk in popular frameworks. Each example covers SDK setup, creating checkouts, handling webhooks, and verifying payments."
      />

      <Callout variant="tip" title="Server-side only">
        The SDK uses your secret API key (
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          sk_live_
        </code>{" "}
        or{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          sk_test_
        </code>
        ). Always call SDK methods from server-side code. Never expose your
        secret key in client bundles.
      </Callout>

      {/* ── Next.js App Router ────────────────────────────────── */}

      <SectionHeading>Next.js (App Router)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The recommended setup for Next.js 13+ with the App Router. SDK calls
        live in Route Handlers and Server Actions.
      </p>

      <SubsectionHeading>File structure</SubsectionHeading>
      <CodeBlock language="bash">{`app/
  layout.tsx
  page.tsx                          # landing / pricing page
  checkout/
    page.tsx                        # client component — redirects to Paylix
  api/
    checkout/
      route.ts                      # POST — creates checkout session
    webhooks/
      paylix/
        route.ts                    # POST — receives webhook events
    verify/
      route.ts                      # GET — verifies payment status
lib/
  paylix.ts                         # shared SDK instance`}</CodeBlock>

      <SubsectionHeading>Shared SDK instance</SubsectionHeading>
      <CodeBlock language="ts" filename="lib/paylix.ts">{`import { Paylix } from "@paylix/sdk";

export const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: process.env.NEXT_PUBLIC_NETWORK === "base" ? "base" : "base-sepolia",
  backendUrl: process.env.NEXT_PUBLIC_PAYLIX_URL!,
});`}</CodeBlock>

      <SubsectionHeading>Create checkout (Route Handler)</SubsectionHeading>
      <CodeBlock language="ts" filename="app/api/checkout/route.ts">{`import { NextRequest, NextResponse } from "next/server";
import { paylix } from "@/lib/paylix";

export async function POST(req: NextRequest) {
  const { productId, customerId } = await req.json();

  const { checkoutUrl, checkoutId } = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${process.env.NEXT_PUBLIC_APP_URL}/success\`,
    cancelUrl: \`\${process.env.NEXT_PUBLIC_APP_URL}/pricing\`,
  });

  return NextResponse.json({ checkoutUrl, checkoutId });
}`}</CodeBlock>

      <SubsectionHeading>Handle webhooks</SubsectionHeading>
      <CodeBlock language="ts" filename="app/api/webhooks/paylix/route.ts">{`import { NextRequest, NextResponse } from "next/server";
import { webhooks } from "@paylix/sdk";

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const signature = req.headers.get("x-paylix-signature")!;

  if (!webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  })) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(payload);

  switch (event.type) {
    case "payment.confirmed":
      await fulfillOrder(event.data);
      break;
    case "subscription.created":
      await activateSubscription(event.data);
      break;
  }

  return NextResponse.json({ received: true });
}`}</CodeBlock>

      <SubsectionHeading>Client redirect</SubsectionHeading>
      <CodeBlock language="ts" filename="app/checkout/page.tsx">{`"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Checkout() {
  const params = useSearchParams();
  const router = useRouter();
  const productId = params.get("product");

  useEffect(() => {
    if (!productId) return;

    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    })
      .then((res) => res.json())
      .then(({ checkoutUrl }) => {
        window.location.href = checkoutUrl;
      });
  }, [productId]);

  return <p>Redirecting to checkout...</p>;
}`}</CodeBlock>

      {/* ── Next.js Pages Router ─────────────────────────────── */}

      <SectionHeading>Next.js (Pages Router)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        If you&apos;re on the Pages Router, SDK calls go in{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          pages/api/
        </code>{" "}
        API routes.
      </p>

      <SubsectionHeading>File structure</SubsectionHeading>
      <CodeBlock language="bash">{`pages/
  index.tsx                         # landing page
  checkout.tsx                      # client — redirects to Paylix
  api/
    checkout.ts                     # POST — creates checkout session
    webhooks/
      paylix.ts                     # POST — receives webhook events
lib/
  paylix.ts                         # shared SDK instance`}</CodeBlock>

      <SubsectionHeading>Create checkout</SubsectionHeading>
      <CodeBlock language="ts" filename="pages/api/checkout.ts">{`import type { NextApiRequest, NextApiResponse } from "next";
import { paylix } from "@/lib/paylix";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end();

  const { productId, customerId } = req.body;

  const { checkoutUrl, checkoutId } = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${process.env.NEXT_PUBLIC_APP_URL}/success\`,
    cancelUrl: \`\${process.env.NEXT_PUBLIC_APP_URL}/pricing\`,
  });

  res.json({ checkoutUrl, checkoutId });
}`}</CodeBlock>

      <SubsectionHeading>Handle webhooks</SubsectionHeading>
      <CodeBlock language="ts" filename="pages/api/webhooks/paylix.ts">{`import type { NextApiRequest, NextApiResponse } from "next";
import { webhooks } from "@paylix/sdk";

export const config = { api: { bodyParser: false } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const payload = Buffer.concat(chunks).toString();
  const signature = req.headers["x-paylix-signature"] as string;

  if (!webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  })) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(payload);

  switch (event.type) {
    case "payment.confirmed":
      await fulfillOrder(event.data);
      break;
    case "subscription.created":
      await activateSubscription(event.data);
      break;
  }

  res.json({ received: true });
}`}</CodeBlock>

      {/* ── React (Vite) ─────────────────────────────────────── */}

      <SectionHeading>React (Vite)</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        A typical React SPA with Vite. The frontend calls your own backend API
        which uses the SDK. Never import{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          @paylix/sdk
        </code>{" "}
        directly from client code.
      </p>

      <SubsectionHeading>File structure</SubsectionHeading>
      <CodeBlock language="bash">{`src/
  App.tsx
  pages/
    Pricing.tsx                     # shows plans, triggers checkout
    Success.tsx                     # post-payment confirmation
  api/
    checkout.ts                     # fetch wrapper for your backend
server/
  index.ts                          # Express / Fastify backend
  routes/
    checkout.ts                     # POST /api/checkout
    webhooks.ts                     # POST /api/webhooks/paylix`}</CodeBlock>

      <SubsectionHeading>Frontend — trigger checkout</SubsectionHeading>
      <CodeBlock language="ts" filename="src/pages/Pricing.tsx">{`export function Pricing() {
  async function handleCheckout(productId: string) {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    const { checkoutUrl } = await res.json();
    window.location.href = checkoutUrl;
  }

  return (
    <div>
      <h1>Pricing</h1>
      <button onClick={() => handleCheckout("prod_starter")}>
        Get Starter — $10/mo
      </button>
      <button onClick={() => handleCheckout("prod_pro")}>
        Get Pro — $25/mo
      </button>
    </div>
  );
}`}</CodeBlock>

      <SubsectionHeading>Backend — Express routes</SubsectionHeading>
      <CodeBlock language="ts" filename="server/routes/checkout.ts">{`import { Router } from "express";
import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});

const router = Router();

router.post("/api/checkout", async (req, res) => {
  const { productId, customerId } = req.body;

  const { checkoutUrl, checkoutId } = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${process.env.APP_URL}/success\`,
    cancelUrl: \`\${process.env.APP_URL}/pricing\`,
  });

  res.json({ checkoutUrl, checkoutId });
});

export default router;`}</CodeBlock>

      {/* ── SvelteKit ────────────────────────────────────────── */}

      <SectionHeading>SvelteKit</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        SvelteKit server routes handle SDK calls. The checkout redirect
        happens via a form action or a{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          +server.ts
        </code>{" "}
        endpoint.
      </p>

      <SubsectionHeading>File structure</SubsectionHeading>
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

      <SubsectionHeading>SDK instance</SubsectionHeading>
      <CodeBlock language="ts" filename="src/lib/server/paylix.ts">{`import { Paylix } from "@paylix/sdk";
import { PAYLIX_SECRET_KEY, PAYLIX_URL } from "$env/static/private";
import { PUBLIC_NETWORK } from "$env/static/public";

export const paylix = new Paylix({
  apiKey: PAYLIX_SECRET_KEY,
  network: PUBLIC_NETWORK === "base" ? "base" : "base-sepolia",
  backendUrl: PAYLIX_URL,
});`}</CodeBlock>

      <SubsectionHeading>Form action — create checkout</SubsectionHeading>
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

      <SubsectionHeading>Checkout page</SubsectionHeading>
      <CodeBlock language="ts" filename="src/routes/checkout/+page.svelte">{`<script>
  import { enhance } from "$app/forms";
</script>

<h1>Choose a plan</h1>

<form method="POST" use:enhance>
  <input type="hidden" name="productId" value="prod_starter" />
  <button type="submit">Get Starter — $10/mo</button>
</form>

<form method="POST" use:enhance>
  <input type="hidden" name="productId" value="prod_pro" />
  <button type="submit">Get Pro — $25/mo</button>
</form>`}</CodeBlock>

      <SubsectionHeading>Handle webhooks</SubsectionHeading>
      <CodeBlock language="ts" filename="src/routes/api/webhooks/paylix/+server.ts">{`import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { webhooks } from "@paylix/sdk";
import { PAYLIX_WEBHOOK_SECRET } from "$env/static/private";

export const POST: RequestHandler = async ({ request }) => {
  const payload = await request.text();
  const signature = request.headers.get("x-paylix-signature")!;

  if (!webhooks.verify({ payload, signature, secret: PAYLIX_WEBHOOK_SECRET })) {
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

      {/* ── Nuxt 3 ──────────────────────────────────────────── */}

      <SectionHeading>Nuxt 3</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Nuxt 3 server routes (
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          server/api/
        </code>
        ) handle SDK calls. Works with both SSR and static generation.
      </p>

      <SubsectionHeading>File structure</SubsectionHeading>
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
  success.vue                       # post-payment`}</CodeBlock>

      <SubsectionHeading>SDK instance</SubsectionHeading>
      <CodeBlock language="ts" filename="server/utils/paylix.ts">{`import { Paylix } from "@paylix/sdk";

const config = useRuntimeConfig();

export const paylix = new Paylix({
  apiKey: config.paylixSecretKey,
  network: config.public.network === "base" ? "base" : "base-sepolia",
  backendUrl: config.paylixUrl,
});`}</CodeBlock>

      <SubsectionHeading>Create checkout</SubsectionHeading>
      <CodeBlock language="ts" filename="server/api/checkout.post.ts">{`export default defineEventHandler(async (event) => {
  const { productId, customerId } = await readBody(event);
  const config = useRuntimeConfig();

  const { checkoutUrl, checkoutId } = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${config.public.appUrl}/success\`,
    cancelUrl: \`\${config.public.appUrl}/checkout\`,
  });

  return { checkoutUrl, checkoutId };
});`}</CodeBlock>

      <SubsectionHeading>Handle webhooks</SubsectionHeading>
      <CodeBlock language="ts" filename="server/api/webhooks/paylix.post.ts">{`import { webhooks } from "@paylix/sdk";

export default defineEventHandler(async (event) => {
  const payload = await readRawBody(event);
  const signature = getHeader(event, "x-paylix-signature")!;
  const config = useRuntimeConfig();

  if (!webhooks.verify({
    payload: payload!,
    signature,
    secret: config.paylixWebhookSecret,
  })) {
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

      <SubsectionHeading>Vue page</SubsectionHeading>
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

      {/* ── Remix ────────────────────────────────────────────── */}

      <SectionHeading>Remix</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Remix loaders and actions run server-side, making them a natural fit
        for SDK calls.
      </p>

      <SubsectionHeading>File structure</SubsectionHeading>
      <CodeBlock language="bash">{`app/
  lib/
    paylix.server.ts                # SDK instance (server module)
  routes/
    _index.tsx                      # landing page
    checkout.tsx                    # action creates session, redirects
    api.webhooks.paylix.tsx         # action handles webhook events
    success.tsx                     # post-payment`}</CodeBlock>

      <SubsectionHeading>Create checkout via action</SubsectionHeading>
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
        <button type="submit">Get Starter — $10/mo</button>
      </Form>
    </div>
  );
}`}</CodeBlock>

      <SubsectionHeading>Handle webhooks</SubsectionHeading>
      <CodeBlock language="ts" filename="app/routes/api.webhooks.paylix.tsx">{`import { json, type ActionFunctionArgs } from "@remix-run/node";
import { webhooks } from "@paylix/sdk";

export async function action({ request }: ActionFunctionArgs) {
  const payload = await request.text();
  const signature = request.headers.get("x-paylix-signature")!;

  if (!webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  })) {
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

      {/* ── Express / Fastify ────────────────────────────────── */}

      <SectionHeading>Express / Fastify</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Standalone Node.js backend without a frontend framework. Works with
        any client — React SPA, mobile app, or a simple HTML form.
      </p>

      <SubsectionHeading>Express</SubsectionHeading>
      <CodeBlock language="ts" filename="server.ts">{`import express from "express";
import { Paylix, webhooks } from "@paylix/sdk";

const app = express();
const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});

app.post("/api/checkout", express.json(), async (req, res) => {
  const { productId, customerId } = req.body;

  const result = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${process.env.APP_URL}/success\`,
    cancelUrl: \`\${process.env.APP_URL}/pricing\`,
  });

  res.json(result);
});

app.post(
  "/api/webhooks/paylix",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const payload = req.body.toString();
    const signature = req.headers["x-paylix-signature"] as string;

    if (!webhooks.verify({
      payload,
      signature,
      secret: process.env.PAYLIX_WEBHOOK_SECRET!,
    })) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(payload);
    // handle event...

    res.json({ received: true });
  },
);

app.listen(3000);`}</CodeBlock>

      <SubsectionHeading>Fastify</SubsectionHeading>
      <CodeBlock language="ts" filename="server.ts">{`import Fastify from "fastify";
import { Paylix, webhooks } from "@paylix/sdk";

const app = Fastify();
const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});

app.post("/api/checkout", async (req, reply) => {
  const { productId, customerId } = req.body as any;

  const result = await paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${process.env.APP_URL}/success\`,
    cancelUrl: \`\${process.env.APP_URL}/pricing\`,
  });

  return result;
});

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => done(null, body),
);

app.post("/api/webhooks/paylix", async (req, reply) => {
  const payload = req.body as string;
  const signature = req.headers["x-paylix-signature"] as string;

  if (!webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  })) {
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const event = JSON.parse(payload);
  // handle event...

  return { received: true };
});

app.listen({ port: 3000 });`}</CodeBlock>
    </>
  );
}

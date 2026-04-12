import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Next.js (App Router)" };

export default function NextAppRouter() {
  return (
    <>
      <PageHeading
        title="Next.js (App Router)"
        description="Integrate Paylix in a Next.js 13+ project using the App Router. SDK calls live in Route Handlers and Server Actions so your secret key never ships to the client."
      />

      <SectionHeading>1. Install</SectionHeading>
      <CodeBlock language="bash">{`npm install @paylix/sdk`}</CodeBlock>

      <SectionHeading>2. Environment variables</SectionHeading>
      <CodeBlock language="bash" filename=".env.local">{`PAYLIX_SECRET_KEY=sk_live_...
PAYLIX_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_PAYLIX_URL=https://your-paylix-instance.com
NEXT_PUBLIC_NETWORK=base
NEXT_PUBLIC_APP_URL=https://yourapp.com`}</CodeBlock>

      <SectionHeading>3. File structure</SectionHeading>
      <CodeBlock language="bash">{`app/
  layout.tsx
  page.tsx                          # landing / pricing page
  checkout/
    page.tsx                        # client component — redirects to Paylix
  success/
    page.tsx                        # post-payment confirmation
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

      <SectionHeading>4. Shared SDK instance</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Create a single Paylix instance and import it everywhere. Keep this
        file server-only — never import it from a client component.
      </p>
      <CodeBlock language="ts" filename="lib/paylix.ts">{`import { Paylix } from "@paylix/sdk";

export const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: process.env.NEXT_PUBLIC_NETWORK === "base" ? "base" : "base-sepolia",
  backendUrl: process.env.NEXT_PUBLIC_PAYLIX_URL!,
});`}</CodeBlock>

      <SectionHeading>5. Create checkout (Route Handler)</SectionHeading>
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

      <SectionHeading>6. Client redirect</SectionHeading>
      <CodeBlock language="ts" filename="app/checkout/page.tsx">{`"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function Checkout() {
  const params = useSearchParams();
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

  return <p>Redirecting to checkout…</p>;
}`}</CodeBlock>

      <SectionHeading>7. Handle webhooks</SectionHeading>
      <Callout variant="tip" title="Use the raw body">
        Always verify against the raw string payload. Parsed JSON will not
        match the signature.
      </Callout>
      <CodeBlock language="ts" filename="app/api/webhooks/paylix/route.ts">{`import { NextRequest, NextResponse } from "next/server";
import { webhooks } from "@paylix/sdk";

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const signature = req.headers.get("x-paylix-signature")!;

  const valid = webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  });

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(payload);

  switch (event.type) {
    case "payment.confirmed":
      // fulfill order
      break;
    case "subscription.created":
      // activate subscription
      break;
    case "subscription.charged":
      // record recurring charge
      break;
    case "subscription.past_due":
      // notify customer
      break;
    case "subscription.cancelled":
      // revoke access
      break;
  }

  return NextResponse.json({ received: true });
}`}</CodeBlock>

      <SectionHeading>8. Verify a payment</SectionHeading>
      <CodeBlock language="ts" filename="app/api/verify/route.ts">{`import { NextRequest, NextResponse } from "next/server";
import { paylix } from "@/lib/paylix";

export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get("paymentId");
  if (!paymentId) {
    return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
  }

  const result = await paylix.verifyPayment({ paymentId });
  return NextResponse.json(result);
}`}</CodeBlock>
    </>
  );
}

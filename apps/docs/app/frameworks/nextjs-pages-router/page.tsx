import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Next.js (Pages Router)" };

export default function NextPagesRouter() {
  return (
    <>
      <PageHeading
        title="Next.js (Pages Router)"
        description="Integrate Paylix in a Next.js project using the classic Pages Router. SDK calls live in pages/api/ handlers."
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
      <CodeBlock language="bash">{`pages/
  index.tsx                         # landing page
  checkout.tsx                      # client — redirects to Paylix
  success.tsx                       # post-payment page
  api/
    checkout.ts                     # POST — creates checkout session
    webhooks/
      paylix.ts                     # POST — receives webhook events
lib/
  paylix.ts                         # shared SDK instance`}</CodeBlock>

      <SectionHeading>4. Shared SDK instance</SectionHeading>
      <CodeBlock language="ts" filename="lib/paylix.ts">{`import { Paylix } from "@paylix/sdk";

export const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: process.env.NEXT_PUBLIC_NETWORK === "base" ? "base" : "base-sepolia",
  backendUrl: process.env.NEXT_PUBLIC_PAYLIX_URL!,
});`}</CodeBlock>

      <SectionHeading>5. Create checkout</SectionHeading>
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

      <SectionHeading>6. Client page</SectionHeading>
      <CodeBlock language="ts" filename="pages/checkout.tsx">{`import { useEffect } from "react";
import { useRouter } from "next/router";

export default function CheckoutPage() {
  const router = useRouter();
  const productId = router.query.product as string | undefined;

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
      <Callout variant="tip" title="Disable the body parser">
        Set{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          bodyParser: false
        </code>{" "}
        on the config so you can read the raw request body for signature
        verification.
      </Callout>
      <CodeBlock language="ts" filename="pages/api/webhooks/paylix.ts">{`import type { NextApiRequest, NextApiResponse } from "next";
import { webhooks } from "@paylix/sdk";

export const config = { api: { bodyParser: false } };

async function readRawBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const payload = await readRawBody(req);
  const signature = req.headers["x-paylix-signature"] as string;

  const valid = webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  });

  if (!valid) {
    return res.status(401).json({ error: "Invalid signature" });
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

  res.json({ received: true });
}`}</CodeBlock>
    </>
  );
}

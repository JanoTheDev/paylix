import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "React (Vite)" };

export default function ReactVite() {
  return (
    <>
      <PageHeading
        title="React (Vite)"
        description="A Vite + React SPA with a small Express backend. The frontend never imports @paylix/sdk directly — all SDK calls go through your own API to keep the secret key server-side."
      />

      <Callout variant="warning" title="Never ship the SDK to the browser">
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          @paylix/sdk
        </code>{" "}
        uses your secret API key. If you import it from a React component it
        will be bundled into your client JavaScript. Always call it from a
        backend route.
      </Callout>

      <SectionHeading>1. Install</SectionHeading>
      <CodeBlock language="bash">{`# frontend
npm install

# backend
npm install @paylix/sdk express cors dotenv
npm install -D @types/express @types/cors tsx`}</CodeBlock>

      <SectionHeading>2. Environment variables</SectionHeading>
      <CodeBlock language="bash" filename=".env">{`PAYLIX_SECRET_KEY=sk_live_...
PAYLIX_WEBHOOK_SECRET=whsec_...
PAYLIX_URL=https://your-paylix-instance.com
APP_URL=https://yourapp.com`}</CodeBlock>

      <SectionHeading>3. File structure</SectionHeading>
      <CodeBlock language="bash">{`src/
  App.tsx
  pages/
    Pricing.tsx                     # shows plans, triggers checkout
    Success.tsx                     # post-payment confirmation
  api/
    checkout.ts                     # fetch wrapper for your backend
  main.tsx
server/
  index.ts                          # Express entrypoint
  paylix.ts                         # SDK instance
  routes/
    checkout.ts                     # POST /api/checkout
    webhooks.ts                     # POST /api/webhooks/paylix
vite.config.ts                      # proxy /api to the backend
.env`}</CodeBlock>

      <SectionHeading>4. Backend SDK instance</SectionHeading>
      <CodeBlock language="ts" filename="server/paylix.ts">{`import "dotenv/config";
import { Paylix } from "@paylix/sdk";

export const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});`}</CodeBlock>

      <SectionHeading>5. Backend server</SectionHeading>
      <CodeBlock language="ts" filename="server/index.ts">{`import express from "express";
import cors from "cors";
import checkoutRoute from "./routes/checkout";
import webhooksRoute from "./routes/webhooks";

const app = express();
app.use(cors());

app.use("/api/webhooks", webhooksRoute); // raw body — before express.json
app.use(express.json());
app.use("/api", checkoutRoute);

app.listen(4000, () => console.log("API on :4000"));`}</CodeBlock>

      <SectionHeading>6. Checkout route</SectionHeading>
      <CodeBlock language="ts" filename="server/routes/checkout.ts">{`import { Router } from "express";
import { paylix } from "../paylix";

const router = Router();

router.post("/checkout", async (req, res) => {
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

      <SectionHeading>7. Webhook route</SectionHeading>
      <CodeBlock language="ts" filename="server/routes/webhooks.ts">{`import { Router, raw } from "express";
import { webhooks } from "@paylix/sdk";

const router = Router();

router.post(
  "/paylix",
  raw({ type: "application/json" }),
  (req, res) => {
    const payload = (req.body as Buffer).toString();
    const signature = req.headers["x-paylix-signature"] as string;

    const valid = webhooks.verify({
      payload,
      signature,
      secret: process.env.PAYLIX_WEBHOOK_SECRET!,
    });

    if (!valid) return res.status(401).json({ error: "Invalid signature" });

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
  },
);

export default router;`}</CodeBlock>

      <SectionHeading>8. Frontend — trigger checkout</SectionHeading>
      <CodeBlock language="ts" filename="src/pages/Pricing.tsx">{`export function Pricing() {
  async function checkout(productId: string) {
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
      <button onClick={() => checkout("prod_starter")}>
        Starter — $10/mo
      </button>
      <button onClick={() => checkout("prod_pro")}>
        Pro — $25/mo
      </button>
    </div>
  );
}`}</CodeBlock>

      <SectionHeading>9. Vite proxy</SectionHeading>
      <CodeBlock language="ts" filename="vite.config.ts">{`import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});`}</CodeBlock>
    </>
  );
}

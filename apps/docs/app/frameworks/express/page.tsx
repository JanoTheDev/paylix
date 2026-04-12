import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Express / Fastify" };

export default function Express() {
  return (
    <>
      <PageHeading
        title="Express / Fastify"
        description="Standalone Node.js backend without a frontend framework. Use this with any client — a React SPA, a mobile app, or a plain HTML form."
      />

      <SectionHeading>1. Install</SectionHeading>
      <CodeBlock language="bash">{`npm install @paylix/sdk express dotenv
npm install -D @types/express tsx typescript`}</CodeBlock>

      <SectionHeading>2. Environment variables</SectionHeading>
      <CodeBlock language="bash" filename=".env">{`PAYLIX_SECRET_KEY=sk_live_...
PAYLIX_WEBHOOK_SECRET=whsec_...
PAYLIX_URL=https://your-paylix-instance.com
APP_URL=https://yourapp.com
PORT=3000`}</CodeBlock>

      <SectionHeading>3. File structure</SectionHeading>
      <CodeBlock language="bash">{`src/
  server.ts                         # entrypoint
  paylix.ts                         # SDK instance
  routes/
    checkout.ts                     # POST /api/checkout
    webhooks.ts                     # POST /api/webhooks/paylix
.env
package.json
tsconfig.json`}</CodeBlock>

      <SectionHeading>4. SDK instance</SectionHeading>
      <CodeBlock language="ts" filename="src/paylix.ts">{`import "dotenv/config";
import { Paylix } from "@paylix/sdk";

export const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});`}</CodeBlock>

      <SectionHeading>5. Express server</SectionHeading>
      <Callout variant="warning" title="Mount webhooks before express.json()">
        Webhook signature verification needs the raw request body. Mount the
        webhook route with{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-primary">
          express.raw()
        </code>{" "}
        before any JSON body parser, otherwise the parsed body will fail
        verification.
      </Callout>
      <CodeBlock language="ts" filename="src/server.ts">{`import express from "express";
import checkoutRoute from "./routes/checkout";
import webhooksRoute from "./routes/webhooks";

const app = express();

// IMPORTANT: webhooks first, before express.json()
app.use("/api/webhooks", webhooksRoute);

app.use(express.json());
app.use("/api", checkoutRoute);

app.listen(process.env.PORT ?? 3000);`}</CodeBlock>

      <SectionHeading>6. Checkout route</SectionHeading>
      <CodeBlock language="ts" filename="src/routes/checkout.ts">{`import { Router } from "express";
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
      <CodeBlock language="ts" filename="src/routes/webhooks.ts">{`import { Router, raw } from "express";
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

      <SectionHeading>Fastify variant</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The same integration on Fastify. The key trick is a content-type
        parser that hands you the raw body string so webhook verification
        still works.
      </p>
      <CodeBlock language="ts" filename="src/server.ts">{`import "dotenv/config";
import Fastify from "fastify";
import { Paylix, webhooks } from "@paylix/sdk";

const app = Fastify();
const paylix = new Paylix({
  apiKey: process.env.PAYLIX_SECRET_KEY!,
  network: "base",
  backendUrl: process.env.PAYLIX_URL!,
});

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => done(null, body),
);

app.post("/api/checkout", async (req) => {
  const { productId, customerId } = JSON.parse(req.body as string);

  return paylix.createCheckout({
    productId,
    customerId,
    successUrl: \`\${process.env.APP_URL}/success\`,
    cancelUrl: \`\${process.env.APP_URL}/pricing\`,
  });
});

app.post("/api/webhooks/paylix", async (req, reply) => {
  const payload = req.body as string;
  const signature = req.headers["x-paylix-signature"] as string;

  const valid = webhooks.verify({
    payload,
    signature,
    secret: process.env.PAYLIX_WEBHOOK_SECRET!,
  });

  if (!valid) return reply.status(401).send({ error: "Invalid signature" });

  const event = JSON.parse(payload);
  // handle event...

  return { received: true };
});

app.listen({ port: Number(process.env.PORT ?? 3000) });`}</CodeBlock>
    </>
  );
}

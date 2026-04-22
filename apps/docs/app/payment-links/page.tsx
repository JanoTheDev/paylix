import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Payment Links" };

export default function PaymentLinksPage() {
  return (
    <>
      <PageHeading
        title="Payment Links"
        description="Permanent URLs you can share anywhere. Every visit spawns a fresh checkout session — no per-buyer API call required."
      />

      <SectionHeading>When to use them</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Use payment links for socials, link-in-bio, QR codes on flyers, or any
        place you'd otherwise hardcode a single checkout URL. Each visitor
        gets their own checkout session so nothing collides.
      </p>

      <SectionHeading>Create from the dashboard</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Open <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">/dashboard/payment-links</code>,
        click <strong>New Link</strong>, and pick a product. Optionally cap
        redemptions. The generated URL is{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          /pay/:linkId
        </code>.
      </p>

      <SectionHeading>Create via the SDK</SectionHeading>
      <CodeBlock language="ts">{`import { Paylix } from "@paylix/sdk";

const paylix = new Paylix({
  apiKey: "sk_test_...",
  network: "base-sepolia",
  backendUrl: "https://pay.example.com",
});

const { link, url } = await paylix.createPaymentLink({
  productId: "prod_abc",
  name: "Twitter bio",
  maxRedemptions: 100,
});

console.log(url);
// https://pay.example.com/pay/<linkId>`}</CodeBlock>

      <SubsectionHeading>Available methods</SubsectionHeading>
      <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-foreground-muted">
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">paylix.createPaymentLink(params)</code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">paylix.listPaymentLinks()</code>
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">paylix.archivePaymentLink(id)</code>
        </li>
      </ul>

      <SectionHeading>Runtime behavior</SectionHeading>
      <ul className="ml-5 list-disc space-y-2 text-sm leading-relaxed text-foreground-muted">
        <li>
          Inactive product or archived link → renders "Link expired".
        </li>
        <li>
          Max redemptions is enforced with a single atomic UPDATE, so two
          concurrent visitors can never push the count past the cap.
        </li>
        <li>
          IP rate-limited at 60 requests / minute / IP.
        </li>
        <li>
          Pre-locked currency: if you set <code>networkKey</code> +{" "}
          <code>tokenSymbol</code> on the link, spawned sessions start in{" "}
          <code>active</code> status. Otherwise they start in{" "}
          <code>awaiting_currency</code> and the buyer picks on the checkout.
        </li>
      </ul>
    </>
  );
}

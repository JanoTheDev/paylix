import type { Metadata } from "next";
import {
  Callout,
  CodeBlock,
  DocTable,
  DocTableBody,
  DocTableCell,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Rate Limits" };

export default function RateLimitsPage() {
  return (
    <>
      <PageHeading
        title="Rate Limits"
        description="Paylix enforces rate limits at multiple layers to protect the platform from abuse and ensure fair usage across all merchants."
      />

      <SectionHeading>Per-API-key limits</SectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Key type</DocTableHeader>
            <DocTableHeader>Limit</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">pk_</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                200 requests / minute
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">sk_</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                100 requests / minute
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Publishable keys have a higher limit because they are used in
        client-side checkout flows where bursts are expected. Secret keys have a
        lower limit because each request carries full access to the merchant
        account.
      </p>

      <SectionHeading>Per-IP relay limit</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        The checkout relay endpoint is limited to{" "}
        <strong className="text-foreground">10 requests per minute</strong> per
        source IP address. This prevents a single client from flooding the
        relayer with gasless payment submissions.
      </p>

      <SectionHeading>Webhook delivery limit</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Paylix delivers a maximum of{" "}
        <strong className="text-foreground">10 deliveries per minute</strong>{" "}
        per webhook URL. Excess deliveries are skipped and logged as warnings.
        This prevents retry-storm DoS scenarios where a failing endpoint
        triggers an avalanche of retries.
      </p>

      <SectionHeading>Redis scaling</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        By default, rate limiting runs in-memory and is scoped to a single
        process. This works for single-instance deployments. For
        multi-instance deployments behind a load balancer, set the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          REDIS_URL
        </code>{" "}
        environment variable to enable Redis-backed distributed rate limiting.
      </p>
      <CodeBlock language="bash">{`REDIS_URL=redis://localhost:6379`}</CodeBlock>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        If Redis becomes unavailable at runtime, rate limiting falls back to
        in-memory automatically.
      </p>

      <SectionHeading>Response format</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        When a rate limit is exceeded, the API returns{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          429 Too Many Requests
        </code>{" "}
        with a{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Retry-After
        </code>{" "}
        header indicating how many seconds to wait before retrying.
      </p>
      <CodeBlock language="json">{`{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Please retry after 12 seconds."
  }
}`}</CodeBlock>

      <Callout variant="info" title="Retry-After header">
        Always respect the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Retry-After
        </code>{" "}
        header value. Continuing to send requests while rate-limited will not
        reset the window.
      </Callout>
    </>
  );
}

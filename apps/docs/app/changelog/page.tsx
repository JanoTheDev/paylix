import type { Metadata } from "next";
import {
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "API Changelog" };

export default function ChangelogPage() {
  return (
    <>
      <PageHeading
        title="API Changelog"
        description={
          <>
            Every API response includes an{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
              x-paylix-version
            </code>{" "}
            header with the current API version (calver date). Breaking changes
            bump the version.
          </>
        }
      />

      <SectionHeading>2026-04-12</SectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          Added free trial support (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialDays
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            trialMinutes
          </code>{" "}
          on products)
        </li>
        <li>
          Added customer CRUD to SDK (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            createCustomer
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            getCustomer
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            updateCustomer
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            listCustomers
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            deleteCustomer
          </code>
          )
        </li>
        <li>
          Added product CRUD to SDK (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            createProduct
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            getProduct
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            updateProduct
          </code>
          ,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            listProducts
          </code>
          )
        </li>
        <li>
          Standardized all API error responses to{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            {`{ error: { code, message } }`}
          </code>
        </li>
        <li>
          Added per-API-key rate limiting (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            pk_
          </code>
          : 200/min,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            sk_
          </code>
          : 100/min)
        </li>
        <li>Added audit logging for sensitive operations</li>
        <li>Added webhook per-URL rate limiting</li>
        <li>Added CSRF origin check</li>
        <li>
          Added{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            x-paylix-version
          </code>{" "}
          response header
        </li>
      </ul>

      <SectionHeading>2026-04-01</SectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>Initial release</li>
        <li>One-time payments and subscriptions</li>
        <li>Dashboard, checkout links, webhooks, API keys</li>
        <li>Self-hosting via Docker Compose</li>
      </ul>
    </>
  );
}

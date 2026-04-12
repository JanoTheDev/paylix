import type { Metadata } from "next";
import {
  CodeBlock,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Audit Logs" };

export default function AuditLogsPage() {
  return (
    <>
      <PageHeading
        title="Audit Logs"
        description="Paylix records an audit trail for every sensitive operation. Use it to track who did what and when across your team."
      />

      <SectionHeading>What gets logged</SectionHeading>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>API key creation and revocation</li>
        <li>Product create and update</li>
        <li>Webhook create, update, and delete</li>
        <li>Subscription cancel, trial cancel, and trial retry</li>
        <li>Customer delete</li>
        <li>Settings updates</li>
      </ul>

      <SectionHeading>Where to view</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Open{" "}
        <strong className="text-foreground">
          Dashboard &rarr; Settings &rarr; Audit Log
        </strong>{" "}
        to browse the full history for your organization.
      </p>

      <SectionHeading>Entry fields</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Each audit log entry records:
      </p>
      <ul className="mt-4 space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <strong className="text-foreground">Timestamp</strong> — when the
          action occurred
        </li>
        <li>
          <strong className="text-foreground">User ID</strong> — who performed
          the action
        </li>
        <li>
          <strong className="text-foreground">Action</strong> — the operation
          performed (e.g.{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
            api_key.created
          </code>
          )
        </li>
        <li>
          <strong className="text-foreground">Resource type</strong> — the kind
          of object affected
        </li>
        <li>
          <strong className="text-foreground">Resource ID</strong> — the
          specific object
        </li>
        <li>
          <strong className="text-foreground">Details</strong> — a JSON object
          with action-specific metadata
        </li>
        <li>
          <strong className="text-foreground">IP address</strong> — the
          requester&apos;s IP
        </li>
      </ul>

      <SectionHeading>Retention</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        All audit log entries are kept indefinitely. There is no automatic
        purge.
      </p>

      <SectionHeading>API access</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Fetch the 100 most recent audit log entries for the current
        organization:
      </p>
      <CodeBlock language="bash">{`GET /api/settings/audit-log`}</CodeBlock>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Returns an array of audit log entries sorted by timestamp descending.
        Requires an authenticated dashboard session.
      </p>
    </>
  );
}

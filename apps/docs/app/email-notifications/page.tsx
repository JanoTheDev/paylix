import type { Metadata } from "next";
import {
  Callout,
  DocTable,
  DocTableBody,
  DocTableCell,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Email Notifications" };

export default function EmailNotificationsPage() {
  return (
    <>
      <PageHeading
        title="Email Notifications"
        description="Paylix sends transactional emails to customers at key moments in the payment and subscription lifecycle."
      />

      <SectionHeading>Emails sent</SectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Email</DocTableHeader>
            <DocTableHeader>When</DocTableHeader>
            <DocTableHeader>Template details</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Invoice</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                After each payment (one-time or subscription charge)
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Invoice number, amount, line items, hosted invoice link
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Trial Started</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Customer starts a free trial
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product name, trial duration, first charge date
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Trial Ending Soon</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                3 days before trial ends
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product name, days remaining, amount, charge date
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Trial Conversion Failed</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Keeper gives up on trial conversion
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product name, failure reason, restart link
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Subscription Created</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Non-trial subscription activated on-chain
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product name, amount, billing interval
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Subscription Cancelled</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Subscription is cancelled
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">Product name</span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Payment Receipt</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Recurring subscription charge succeeds
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product name, amount, next charge date
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell>
              <span className="text-foreground">Past Due Reminder</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Subscription charge fails, status flips to past_due
              </span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product name, token needed
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>

      <SectionHeading>Requirements</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Emails require the customer to have an email address on file. Customers
        without an email address silently skip all notifications.
      </p>

      <SectionHeading>Disabling automatic emails</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        You can control which emails Paylix sends from{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          Settings → Notifications
        </code>
        . There are two layers of control:
      </p>
      <ul className="mt-3 space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted [&>li]:list-disc">
        <li>
          <strong className="text-foreground">Master switch</strong> — kills
          every email in one click. Useful when you want to take full
          ownership of transactional email and send everything yourself.
        </li>
        <li>
          <strong className="text-foreground">Per-type toggles</strong> —
          turn individual email types on or off independently. For example,
          send your own custom welcome email but still let Paylix send
          recurring receipts and past-due reminders. Each of the 8 email
          types above has its own switch.
        </li>
      </ul>
      <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
        Webhook events always fire regardless of these settings — disabling
        an email only skips the delivery, not the event. Subscribe to{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          invoice.issued
        </code>
        ,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          subscription.created
        </code>
        ,{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          subscription.charged
        </code>
        , and{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          subscription.past_due
        </code>{" "}
        to drive your own templated messages.
      </p>
      <Callout variant="tip" title="Invoices still generate">
        Disabling notifications only skips <em>email delivery</em>. Invoices,
        receipts, and hosted/PDF URLs are still generated for every payment so
        your customers can always fetch them from the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          invoice.issued
        </code>{" "}
        webhook payload or the customer portal.
      </Callout>

      <SectionHeading>Mailer configuration</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Set the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          INVOICE_FROM_EMAIL
        </code>{" "}
        environment variable to configure the sender address. The default is{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          invoices@paylix.local
        </code>
        . Email delivery uses the{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          @paylix/mailer
        </code>{" "}
        transport.
      </p>

      <Callout variant="info" title="Production sender">
        For production, set{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          INVOICE_FROM_EMAIL
        </code>{" "}
        to a verified domain address (e.g.{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          billing@yourdomain.com
        </code>
        ) to ensure deliverability.
      </Callout>
    </>
  );
}

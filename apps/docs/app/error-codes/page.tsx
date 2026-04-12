import type { Metadata } from "next";
import {
  DocTable,
  DocTableBody,
  DocTableCell,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  SectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Error Codes" };

export default function ErrorCodesPage() {
  return (
    <>
      <PageHeading
        title="Error Codes Reference"
        description="All Paylix API errors follow a standardized format. Use the code field to handle errors programmatically."
      />

      <SectionHeading>Response shape</SectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Every error response has the same structure. Some errors include an
        optional{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
          details
        </code>{" "}
        field with validation specifics.
      </p>
      <pre className="mt-4 rounded-lg border border-border bg-surface-2 p-4 font-mono text-[13px] text-foreground">
{`{
  "error": {
    "code": "validation_failed",
    "message": "Human-readable description.",
    "details": { ... }
  }
}`}
      </pre>

      <SectionHeading>General errors</SectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Code</DocTableHeader>
            <DocTableHeader>HTTP</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">validation_failed</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Request body failed validation. Check the{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  details
                </code>{" "}
                field for specific errors.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">invalid_body</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Missing or malformed required fields.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">invalid_request</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Request is well-formed but semantically invalid (e.g. no fields
                to update).
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">not_found</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">404</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Resource does not exist or is not accessible.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">unauthorized</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">401</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Missing or invalid authentication credentials.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">forbidden</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">403</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Authenticated but not permitted for this resource.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">csrf_rejected</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">403</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Cross-origin request blocked.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">rate_limited</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">429</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Too many requests. Retry after the time in the{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-primary">
                  Retry-After
                </code>{" "}
                header.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">conflict</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Resource already exists or is in a conflicting state.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">invalid_token</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">401</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Invalid or expired portal token.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">no_active_org</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                No active team/organization selected.
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>

      <SectionHeading>Checkout and payment errors</SectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Code</DocTableHeader>
            <DocTableHeader>HTTP</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">session_not_found</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">404</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Checkout session not found.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">session_expired</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Checkout session has expired.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">session_not_payable</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Checkout session is not in a payable state.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">session_already_relayed</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Payment already submitted for this session.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">relay_failed</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">502</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Relayer transaction failed.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">currency_not_selected</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Buyer must select a currency before paying.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">invalid_interval</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Product has no valid billing interval.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">deadline_passed</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Permit signature deadline is in the past or too far in the
                future.
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>

      <SectionHeading>Subscription and trial errors</SectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Code</DocTableHeader>
            <DocTableHeader>HTTP</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">duplicate_subscription</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Customer already has an active/trialing subscription for this
                product.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">trial_in_progress</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Customer already used the free trial for this product.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">email_required</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Email address required for trial checkout.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">disposable_email</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Disposable email addresses not allowed for trials.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">wallet_inactive</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Wallet has no on-chain history (trial anti-abuse).
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">missing_email</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">400</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Customer has no email address on file.
              </span>
            </DocTableCell>
          </DocTableRow>
          <DocTableRow>
            <DocTableCell mono>
              <span className="text-foreground">missing_signature</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">409</span>
            </DocTableCell>
            <DocTableCell>
              <span className="text-foreground-muted">
                Trial conversion signature was cleared — customer must
                re-checkout.
              </span>
            </DocTableCell>
          </DocTableRow>
        </DocTableBody>
      </DocTable>
    </>
  );
}

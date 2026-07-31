import type { Metadata } from "next";
import {
  CodeBlock,
  DocTable,
  DocTableBody,
  DocTableHead,
  DocTableHeader,
  DocTableRow,
  PageHeading,
  ParamRow,
  SectionHeading,
  SubsectionHeading,
} from "@/components/docs";

export const metadata: Metadata = { title: "Blocklist — SDK Reference" };

export default function BlocklistReference() {
  return (
    <>
      <PageHeading
        title="Blocklist"
        description="List, add, and remove wallet / email / country entries that should never be allowed to pay."
      />

      <SectionHeading>paylix.listBlocklist()</SectionHeading>
      <CodeBlock language="ts">{`paylix.listBlocklist(): Promise<BlocklistEntry[]>`}</CodeBlock>

      <SubsectionHeading>BlocklistEntry</SubsectionHeading>
      <DocTable>
        <DocTableHead>
          <DocTableRow>
            <DocTableHeader>Field</DocTableHeader>
            <DocTableHeader>Type</DocTableHeader>
            <DocTableHeader>Description</DocTableHeader>
          </DocTableRow>
        </DocTableHead>
        <DocTableBody>
          <ParamRow name="id" type="string" description="Entry ID." />
          <ParamRow name="type" type='"wallet" | "email" | "country"' description="What kind of identifier this blocks." />
          <ParamRow name="value" type="string" description="Canonicalized value: lowercase wallet address, uppercase ISO 3166-1 alpha-2 country code, or a normalized email address (Gmail dots stripped and +tag removed)." />
          <ParamRow name="reason" type="string | null" description="Free-form note from the merchant." />
          <ParamRow name="createdBy" type="string | null" description="User id of the dashboard operator who added the entry." />
          <ParamRow name="createdAt" type="string" description="ISO-8601 timestamp." />
        </DocTableBody>
      </DocTable>

      <SectionHeading>paylix.addBlocklistEntry(params)</SectionHeading>
      <CodeBlock language="ts">{`paylix.addBlocklistEntry({
  type: "wallet",
  value: "0x1234…abcd",
  reason: "Chargeback attempt",
});

paylix.addBlocklistEntry({ type: "email", value: "spammer@gmail.com" }); // Gmail-normalized
paylix.addBlocklistEntry({ type: "country", value: "XX" });              // ISO 3166 alpha-2`}</CodeBlock>

      <SectionHeading>paylix.removeBlocklistEntry(id)</SectionHeading>
      <CodeBlock language="ts">{`paylix.removeBlocklistEntry("blk_..."): Promise<void>`}</CodeBlock>

      <SubsectionHeading>Enforcement</SubsectionHeading>
      <p className="text-sm leading-relaxed text-foreground-muted">
        Matches are evaluated inside the relay route before any on-chain
        activity. A blocked buyer gets HTTP 403 with error code{" "}
        <code>blocked</code>. The matching entry is never echoed back to
        the caller.
      </p>
    </>
  );
}

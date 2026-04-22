import { eq } from "drizzle-orm";
import { createDb } from "@paylix/db/client";
import { merchantProfiles } from "@paylix/db/schema";
import { config } from "../config";
import { EMPTY_BRANDING, type EmailBranding } from "./branding";

const db = createDb(config.databaseUrl);

/**
 * Load the merchant's email branding bundle once per send. Returns the
 * EMPTY_BRANDING sentinel when the org has no profile row, which lets
 * templates render a neutral Paylix header/footer without special-case
 * code at every call site.
 */
export async function loadEmailBranding(
  organizationId: string,
): Promise<EmailBranding> {
  const [row] = await db
    .select({
      legalName: merchantProfiles.legalName,
      logoUrl: merchantProfiles.logoUrl,
      supportEmail: merchantProfiles.supportEmail,
      invoiceFooter: merchantProfiles.invoiceFooter,
    })
    .from(merchantProfiles)
    .where(eq(merchantProfiles.organizationId, organizationId))
    .limit(1);
  if (!row) return EMPTY_BRANDING;
  return {
    legalName: row.legalName?.trim() ? row.legalName : null,
    logoUrl: row.logoUrl?.trim() ? row.logoUrl : null,
    supportEmail: row.supportEmail?.trim() ? row.supportEmail : null,
    invoiceFooter: row.invoiceFooter?.trim() ? row.invoiceFooter : null,
  };
}

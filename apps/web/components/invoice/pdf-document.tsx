import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Invoice, InvoiceLineItem } from "@paylix/db/schema";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#0b0b0f" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  merchant: { maxWidth: 280 },
  title: { fontSize: 9, textTransform: "uppercase", color: "#6b7280" },
  number: { fontSize: 16, marginTop: 2 },
  section: { marginBottom: 16 },
  row: { flexDirection: "row", borderBottom: "1pt solid #e5e7eb", paddingVertical: 6 },
  col1: { flex: 3 },
  col2: { flex: 1, textAlign: "right" },
  col3: { flex: 1.5, textAlign: "right" },
  col4: { flex: 1.5, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 200 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: { borderTop: "1pt solid #0b0b0f", marginTop: 6, paddingTop: 6, fontSize: 12 },
  footer: { position: "absolute", bottom: 40, left: 40, right: 40, fontSize: 8, color: "#6b7280" },
});

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

interface Props {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
}

export function InvoicePdfDocument({ invoice, lineItems }: Props) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.merchant}>
            <Text>{invoice.merchantLegalName}</Text>
            <Text>{invoice.merchantAddressLine1}</Text>
            {invoice.merchantAddressLine2 && <Text>{invoice.merchantAddressLine2}</Text>}
            <Text>
              {invoice.merchantCity} {invoice.merchantPostalCode}
            </Text>
            <Text>{invoice.merchantCountry}</Text>
            {invoice.merchantTaxId && <Text>Tax ID: {invoice.merchantTaxId}</Text>}
          </View>
          <View>
            <Text style={styles.title}>Invoice</Text>
            <Text style={styles.number}>{invoice.number}</Text>
            <Text style={{ marginTop: 4 }}>
              Issued {new Date(invoice.issuedAt).toLocaleDateString()}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>Bill to</Text>
          {invoice.customerName && <Text>{invoice.customerName}</Text>}
          {invoice.customerEmail && <Text>{invoice.customerEmail}</Text>}
          {invoice.customerCountry && <Text>{invoice.customerCountry}</Text>}
          {invoice.customerTaxId && <Text>Tax ID: {invoice.customerTaxId}</Text>}
        </View>

        <View style={[styles.row, { borderBottom: "1pt solid #0b0b0f" }]}>
          <Text style={styles.col1}>Description</Text>
          <Text style={styles.col2}>Qty</Text>
          <Text style={styles.col3}>Unit</Text>
          <Text style={styles.col4}>Amount</Text>
        </View>
        {lineItems.map((li) => (
          <View style={styles.row} key={li.id}>
            <Text style={styles.col1}>{li.description}</Text>
            <Text style={styles.col2}>{li.quantity}</Text>
            <Text style={styles.col3}>{money(li.unitAmountCents, invoice.currency)}</Text>
            <Text style={styles.col4}>{money(li.amountCents, invoice.currency)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(invoice.subtotalCents, invoice.currency)}</Text>
          </View>
          {invoice.taxLabel && (
            <View style={styles.totalRow}>
              <Text>{invoice.taxLabel}</Text>
              <Text>{money(invoice.taxCents, invoice.currency)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text>Total</Text>
            <Text>{money(invoice.totalCents, invoice.currency)}</Text>
          </View>
        </View>

        {invoice.merchantFooter && <Text style={styles.footer}>{invoice.merchantFooter}</Text>}
      </Page>
    </Document>
  );
}

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

// Export the expected invoice count so callers can assert exact detection.
// This is the single source of truth — if you add or remove an invoice here,
// the smoke-test assertion automatically stays in sync.
export const EXPECTED_INVOICE_COUNT = 3;

// Vendor names MUST match names in scripts/src/seed.ts within the 85% fuzzy-match
// threshold so that vendor matching succeeds during smoke-test extraction.
//
// Invoice numbers are suffixed with SMOKE_RUN_ID (supplied by smoke_test.mjs)
// so that each test run produces unique numbers and the duplicate-invoice guard
// never blocks the suite.  When run standalone, a timestamp suffix is used.
const runSuffix = process.env.SMOKE_RUN_ID ?? `standalone-${Date.now()}`;
const invoices = [
  { vendor: "Acme Office Supplies Inc.", num: `ACME-${runSuffix}`, date: "2026-05-01", total: "1250.00", tax: "100.00", sub: "1150.00" },
  { vendor: "FastFreight Logistics",     num: `FF-${runSuffix}`,   date: "2026-05-03", total: "880.50",  tax: "70.50",  sub: "810.00"  },
  { vendor: "TechParts Global Ltd.",     num: `TP-${runSuffix}`,   date: "2026-05-07", total: "4300.00", tax: "300.00", sub: "4000.00" },
];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

for (const inv of invoices) {
  const page = doc.addPage([612, 792]);
  let y = 740;
  const line = (text, f = font, size = 12) => { page.drawText(text, { x: 50, y, size, font: f, color: rgb(0,0,0) }); y -= size + 8; };
  line("INVOICE", bold, 24);
  y -= 6;
  line(`Vendor: ${inv.vendor}`, bold, 14);
  line(`Invoice Number: ${inv.num}`);
  line(`Invoice Date: ${inv.date}`);
  line(`Payment Terms: Net 30`);
  y -= 10;
  line("Description: Professional services rendered");
  line(`Subtotal: $${inv.sub}`);
  line(`Tax: $${inv.tax}`);
  line(`Total Amount Due: $${inv.total}`, bold, 14);
  y -= 20;
  line("Thank you for your business.", font, 10);
}

const bytes = await doc.save();
writeFileSync("/tmp/multi_invoice.pdf", bytes);
// Write machine-readable metadata so smoke_test.mjs can assert exact page counts
// without parsing stdout or duplicating the invoice list.
writeFileSync(
  "/tmp/multi_invoice_meta.json",
  JSON.stringify({ expectedInvoiceCount: EXPECTED_INVOICE_COUNT }),
);
console.log("wrote /tmp/multi_invoice.pdf", bytes.length, "bytes,", invoices.length, "pages");

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const invoices = [
  { vendor: "Acme Office Supplies Inc.", num: "ACME-1001", date: "2026-05-01", total: "1250.00", tax: "100.00", sub: "1150.00" },
  { vendor: "Globex Logistics LLC", num: "GLX-5582", date: "2026-05-03", total: "880.50", tax: "70.50", sub: "810.00" },
  { vendor: "Initech Software Co.", num: "INI-9090", date: "2026-05-07", total: "4300.00", tax: "300.00", sub: "4000.00" },
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
console.log("wrote /tmp/multi_invoice.pdf", bytes.length, "bytes,", invoices.length, "pages");

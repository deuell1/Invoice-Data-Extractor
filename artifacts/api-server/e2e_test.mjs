import { readFileSync } from "node:fs";
const BASE = "http://localhost:8080/api";
const pdf = readFileSync("/tmp/multi_invoice.pdf");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const up = await fetch(`${BASE}/storage/uploads/request-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "multi_invoice.pdf", size: pdf.length, contentType: "application/pdf" }) });
const upData = await j(up);
if (!up.ok) { console.log("upload-url FAIL", up.status); process.exit(1); }
const put = await fetch(upData.uploadURL, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } });
if (!put.ok) { console.log("PUT FAIL", put.status); process.exit(1); }
const cs = await fetch(`${BASE}/source-documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileObjectPath: upData.objectPath, originalFileName: "multi_invoice.pdf", contentType: "application/pdf" }) });
const csData = await j(cs);
if (!cs.ok) { console.log("create FAIL", cs.status, JSON.stringify(csData).slice(0,300)); process.exit(1); }
const id = csData.source.id;
let sawCompletedWithZero = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const d = await j(await fetch(`${BASE}/source-documents/${id}`));
  const s = d.source;
  if ((s.processingStatus === "COMPLETED" || s.processingStatus === "EXCEPTION") && (s.detectedInvoiceCount > 0) && d.invoiceCount === 0) sawCompletedWithZero = true;
  const stillExtracting = d.invoices.some((x) => !x.extractionStatus || x.extractionStatus === "PENDING" || x.extractionStatus === "PROCESSING");
  console.log(`poll ${i}: proc=${s.processingStatus} detected=${s.detectedInvoiceCount} invoices=${d.invoiceCount} extracted=${d.extractedCount} exc=${d.exceptionCount}`);
  if ((s.processingStatus === "COMPLETED" || s.processingStatus === "EXCEPTION") && d.invoiceCount > 0 && !stillExtracting) {
    console.log("\nRACE check (COMPLETED with 0 invoices ever seen):", sawCompletedWithZero ? "FAILED" : "PASS");
    for (const inv of d.invoices) console.log(`  seq=${inv.invoiceSequence} pages=${inv.pageStart}-${inv.pageEnd} status=${inv.status} vendor="${inv.vendorRawName}" total=${inv.totalAmount}`);
    process.exit(sawCompletedWithZero ? 2 : 0);
  }
}
console.log("TIMED OUT");
process.exit(3);

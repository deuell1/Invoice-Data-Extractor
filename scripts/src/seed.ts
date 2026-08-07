import { db, vendorIdTable, invoiceCaptureTable, invoiceAuditLogTable } from "@workspace/db";
import type { InsertVendor, InsertInvoice } from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  // Vendors
  const vendors: InsertVendor[] = [
    {
      vendorCode: "ACME-001",
      vendorName: "Acme Office Supplies Inc.",
      taxId: "12-3456789",
      address: "100 Industrial Blvd, Springfield, IL 62701",
      contactEmail: "ap@acmesupplies.com",
      contactPhone: "+1-217-555-0100",
      paymentTerms: "Net 30",
      isActive: true,
    },
    {
      vendorCode: "TECH-002",
      vendorName: "TechParts Global Ltd.",
      taxId: "98-7654321",
      address: "200 Silicon Way, San Jose, CA 95101",
      contactEmail: "invoices@techpartsglobal.com",
      contactPhone: "+1-408-555-0200",
      paymentTerms: "Net 45",
      isActive: true,
    },
    {
      vendorCode: "FAST-003",
      vendorName: "FastFreight Logistics",
      taxId: "55-1234567",
      address: "300 Dock St, Memphis, TN 38101",
      contactEmail: "billing@fastfreight.com",
      contactPhone: "+1-901-555-0300",
      paymentTerms: "Net 15",
      isActive: true,
    },
  ];

  const insertedVendors: Array<typeof vendorIdTable.$inferSelect> = [];
  for (const v of vendors) {
    const existing = await db
      .select()
      .from(vendorIdTable)
      .where(eq(vendorIdTable.vendorCode, v.vendorCode))
      .limit(1);
    if (existing.length === 0) {
      const [inserted] = await db.insert(vendorIdTable).values(v).returning();
      insertedVendors.push(inserted);
      console.log(`  Created vendor: ${v.vendorCode}`);
    } else {
      insertedVendors.push(existing[0]);
      console.log(`  Skipped vendor (exists): ${v.vendorCode}`);
    }
  }

  // Sample invoices
  const acme = insertedVendors.find((v) => v.vendorCode === "ACME-001");
  const tech = insertedVendors.find((v) => v.vendorCode === "TECH-002");
  const fast = insertedVendors.find((v) => v.vendorCode === "FAST-003");

  const invoices: InsertInvoice[] = [
    {
      status: "PENDING_EXTRACTION",
      vendorId: acme?.id ?? null,
      invoiceNumber: null,
      invoiceDate: null,
      totalAmount: null,
      taxAmount: null,
      poNumber: null,
      currency: "USD",
      fileObjectPath: "/objects/uploads/sample-invoice-001",
      originalFileName: "acme-invoice-oct-2025.pdf",
      confidenceScore: null,
      lowConfidenceFields: null,
    },
    {
      status: "PENDING_APPROVAL",
      vendorId: tech?.id ?? null,
      invoiceNumber: "INV-2025-8821",
      invoiceDate: "2025-10-15",
      totalAmount: "12450.00",
      taxAmount: "1245.00",
      poNumber: "PO-88210",
      currency: "USD",
      fileObjectPath: "/objects/uploads/sample-invoice-002",
      originalFileName: "techparts-INV-2025-8821.pdf",
      confidenceScore: "0.9500",
      lowConfidenceFields: null,
    },
    {
      status: "EXCEPTION",
      vendorId: fast?.id ?? null,
      invoiceNumber: "FF-78432",
      invoiceDate: "2025-10-01",
      totalAmount: "3200.00",
      taxAmount: null,
      poNumber: null,
      currency: "USD",
      fileObjectPath: "/objects/uploads/sample-invoice-003",
      originalFileName: "fastfreight-FF-78432.pdf",
      confidenceScore: "0.5500",
      lowConfidenceFields: "totalAmount,poNumber",
      exceptionReason: "Low confidence score: 0.55",
    },
    {
      status: "APPROVED",
      vendorId: acme?.id ?? null,
      invoiceNumber: "ACME-2025-4411",
      invoiceDate: "2025-09-28",
      totalAmount: "8750.00",
      taxAmount: "875.00",
      poNumber: "PO-44110",
      currency: "USD",
      fileObjectPath: "/objects/uploads/sample-invoice-004",
      originalFileName: "acme-ACME-2025-4411.pdf",
      confidenceScore: "0.9800",
      lowConfidenceFields: null,
    },
  ];

  for (const inv of invoices) {
    const existing = await db
      .select()
      .from(invoiceCaptureTable)
      .where(eq(invoiceCaptureTable.fileObjectPath, inv.fileObjectPath))
      .limit(1);

    if (existing.length === 0) {
      const [inserted] = await db.insert(invoiceCaptureTable).values(inv).returning();
      await db.insert(invoiceAuditLogTable).values({
        invoiceId: inserted.id,
        action: "CREATED",
        actorClerkId: "system-pipeline",
        note: `Seeded invoice: ${inv.originalFileName}`,
      });
      console.log(`  Created invoice: ${inv.originalFileName}`);
    } else {
      console.log(`  Skipped invoice (exists): ${inv.originalFileName}`);
    }
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

import { eq, ne } from "drizzle-orm";
import {
  db,
  vendorIdTable,
  poHeaderTable,
  invoiceCaptureTable,
  importBatchTable,
  type ImportBatch,
  type ImportRowError,
} from "@workspace/db";
import { toCsv } from "../lib/csv";

/**
 * Import workflow service: CSV template generation, file validation (no DB
 * writes) and commit (applies accepted rows to the database). Parsing and all
 * business-rule validation live here so the route stays thin.
 *
 * Import types map to reference-data tables:
 *   VENDOR_MASTER      → vendor_id
 *   PO_REFERENCE       → po_header
 *   INVOICE_CORRECTION → invoice_capture (matched-vendor rows only; vendors are
 *                        NEVER auto-created)
 */

export type ImportType =
  | "VENDOR_MASTER"
  | "PO_REFERENCE"
  | "INVOICE_CORRECTION";

type ColumnType = "string" | "number" | "int" | "date";

interface ColumnSpec {
  name: string;
  required?: boolean;
  type?: ColumnType;
  example?: string;
}

const COLUMN_SPECS: Record<ImportType, ColumnSpec[]> = {
  VENDOR_MASTER: [
    { name: "vendorCode", required: true, example: "V-1001" },
    { name: "vendorName", required: true, example: "Acme Supplies Inc." },
    { name: "taxId", example: "12-3456789" },
    { name: "address", example: "123 Main St, Springfield" },
    { name: "contactEmail", example: "ap@acme.example" },
    { name: "contactPhone", example: "+1-555-0100" },
    { name: "paymentTerms", example: "NET30" },
    { name: "termsDays", type: "int", example: "30" },
  ],
  PO_REFERENCE: [
    { name: "poNumber", required: true, example: "PO-5001" },
    { name: "vendorCode", example: "V-1001" },
    { name: "poDate", type: "date", example: "2024-01-15" },
    { name: "buyer", example: "Jane Buyer" },
    { name: "description", example: "Office supplies" },
    { name: "totalAmount", type: "number", example: "1500.00" },
    { name: "currency", example: "USD" },
    { name: "status", example: "OPEN" },
  ],
  INVOICE_CORRECTION: [
    { name: "vendorCode", example: "V-1001" },
    { name: "vendorName", example: "Acme Supplies Inc." },
    { name: "invoiceNumber", required: true, example: "INV-2024-001" },
    { name: "invoiceDate", type: "date", example: "2024-01-20" },
    { name: "poNumber", example: "PO-5001" },
    { name: "subtotal", type: "number", example: "1400.00" },
    { name: "taxAmount", type: "number", example: "100.00" },
    { name: "totalAmount", type: "number", example: "1500.00" },
    { name: "currency", example: "USD" },
    { name: "paymentTerms", example: "NET30" },
    { name: "dueDate", type: "date", example: "2024-02-19" },
  ],
};

// ─── CSV template ────────────────────────────────────────────────────────────
export function getTemplateCsv(importType: ImportType): string {
  const specs = COLUMN_SPECS[importType];
  const headers = specs.map((s) => s.name);
  const example = specs.map((s) => s.example ?? "");
  return toCsv(headers, [example]);
}

export function templateFileName(importType: ImportType): string {
  return `${importType.toLowerCase()}_import_template.csv`;
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────
/** Minimal RFC-4180-style CSV parser (handles quotes, escaped quotes, commas, newlines). */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

function isValidDate(v: string): boolean {
  return !Number.isNaN(Date.parse(v));
}

// ─── Validation / analysis ───────────────────────────────────────────────────
export interface PreviewRow {
  rowNumber: number;
  valid: boolean;
  data: Record<string, string>;
  errors: string[];
}

interface InternalRow extends PreviewRow {
  entity: Record<string, unknown>;
  dbExists: boolean;
}

export interface ImportAnalysis {
  importType: string;
  fileName: string;
  columns: string[];
  rowCount: number;
  rowsValid: number;
  rowsRejected: number;
  preview: PreviewRow[];
  errorSummary: string | null;
  hasBlockingErrors: boolean;
  rows: InternalRow[];
}

interface AnalyzeOptions {
  updateExisting?: boolean;
}

export async function analyzeImport(
  importType: ImportType,
  fileName: string,
  content: string,
  opts: AnalyzeOptions = {},
): Promise<ImportAnalysis> {
  const updateExisting = opts.updateExisting ?? false;
  const specs = COLUMN_SPECS[importType];

  const grid = parseCsv(content).filter((r) => r.some((c) => c.trim() !== ""));
  const columns = grid.length > 0 ? grid[0].map((h) => h.trim()) : [];
  const dataRows = grid.slice(1);

  const headerIndex = new Map<string, number>();
  columns.forEach((c, idx) => headerIndex.set(c.toLowerCase(), idx));
  const cellAt = (cells: string[], specName: string): string => {
    const idx = headerIndex.get(specName.toLowerCase());
    if (idx == null) return "";
    return (cells[idx] ?? "").trim();
  };

  // ── Prefetch existing data needed for business rules ──
  const existingVendorCodes = new Set<string>();
  const vendorByCode = new Map<string, { id: number }>();
  const vendorByName = new Map<string, { id: number }>();
  const existingPoNumbers = new Set<string>();
  const existingInvoiceKeys = new Map<string, { id: number }>();

  if (importType === "VENDOR_MASTER" || importType === "INVOICE_CORRECTION") {
    const vendors = await db
      .select({
        id: vendorIdTable.id,
        vendorCode: vendorIdTable.vendorCode,
        vendorName: vendorIdTable.vendorName,
      })
      .from(vendorIdTable);
    for (const v of vendors) {
      existingVendorCodes.add(v.vendorCode.toLowerCase());
      vendorByCode.set(v.vendorCode.toLowerCase(), { id: v.id });
      if (!vendorByName.has(v.vendorName.toLowerCase())) {
        vendorByName.set(v.vendorName.toLowerCase(), { id: v.id });
      }
    }
  }
  if (importType === "PO_REFERENCE") {
    const pos = await db
      .select({ poNumber: poHeaderTable.poNumber })
      .from(poHeaderTable);
    for (const p of pos) existingPoNumbers.add(p.poNumber.toLowerCase());
  }
  if (importType === "INVOICE_CORRECTION") {
    const invs = await db
      .select({
        id: invoiceCaptureTable.id,
        vendorId: invoiceCaptureTable.vendorId,
        invoiceNumber: invoiceCaptureTable.invoiceNumber,
      })
      .from(invoiceCaptureTable)
      .where(ne(invoiceCaptureTable.status, "VOIDED"));
    for (const r of invs) {
      if (r.vendorId != null && r.invoiceNumber) {
        existingInvoiceKeys.set(
          `${r.vendorId}::${r.invoiceNumber.toLowerCase()}`,
          { id: r.id },
        );
      }
    }
  }

  const seenVendorCodes = new Set<string>();
  const seenPoNumbers = new Set<string>();
  const seenInvoiceKeys = new Set<string>();

  const rows: InternalRow[] = [];

  dataRows.forEach((cells, idx) => {
    const rowNumber = idx + 1;
    const data: Record<string, string> = {};
    columns.forEach((c, i) => {
      data[c] = (cells[i] ?? "").trim();
    });

    const errors: string[] = [];

    // Generic required + type checks.
    for (const spec of specs) {
      const v = cellAt(cells, spec.name);
      if (spec.required && v === "") {
        errors.push(`${spec.name} is required`);
        continue;
      }
      if (v === "") continue;
      if (spec.type === "number" || spec.type === "int") {
        if (!Number.isFinite(Number(v))) {
          errors.push(`${spec.name} must be a number`);
        } else if (spec.type === "int" && !Number.isInteger(Number(v))) {
          errors.push(`${spec.name} must be a whole number`);
        }
      } else if (spec.type === "date") {
        if (!isValidDate(v)) {
          errors.push(`${spec.name} must be a valid date (YYYY-MM-DD)`);
        }
      }
    }

    let entity: Record<string, unknown> = {};
    let dbExists = false;

    if (importType === "VENDOR_MASTER") {
      const code = cellAt(cells, "vendorCode");
      if (code) {
        const key = code.toLowerCase();
        if (seenVendorCodes.has(key)) {
          errors.push(`Duplicate vendorCode '${code}' within file`);
        } else {
          seenVendorCodes.add(key);
        }
        dbExists = existingVendorCodes.has(key);
        if (dbExists && !updateExisting) {
          errors.push(`Vendor code '${code}' already exists`);
        }
      }
      const termsDays = cellAt(cells, "termsDays");
      entity = {
        vendorCode: code,
        vendorName: cellAt(cells, "vendorName"),
        taxId: cellAt(cells, "taxId") || null,
        address: cellAt(cells, "address") || null,
        contactEmail: cellAt(cells, "contactEmail") || null,
        contactPhone: cellAt(cells, "contactPhone") || null,
        paymentTerms: cellAt(cells, "paymentTerms") || null,
        termsDays: termsDays !== "" ? Math.trunc(Number(termsDays)) : null,
      };
    } else if (importType === "PO_REFERENCE") {
      const po = cellAt(cells, "poNumber");
      if (po) {
        const key = po.toLowerCase();
        if (seenPoNumbers.has(key)) {
          errors.push(`Duplicate poNumber '${po}' within file`);
        } else {
          seenPoNumbers.add(key);
        }
        dbExists = existingPoNumbers.has(key);
        if (dbExists && !updateExisting) {
          errors.push(`PO number '${po}' already exists`);
        }
      }
      const total = cellAt(cells, "totalAmount");
      entity = {
        poNumber: po,
        vendorCode: cellAt(cells, "vendorCode") || null,
        poDate: cellAt(cells, "poDate") || null,
        buyer: cellAt(cells, "buyer") || null,
        description: cellAt(cells, "description") || null,
        totalAmount: total !== "" ? total : null,
        currency: cellAt(cells, "currency") || "USD",
        status: cellAt(cells, "status") || "OPEN",
      };
    } else {
      // INVOICE_CORRECTION
      const code = cellAt(cells, "vendorCode");
      const name = cellAt(cells, "vendorName");
      let matched: { id: number } | undefined;
      if (code) matched = vendorByCode.get(code.toLowerCase());
      if (!matched && name) matched = vendorByName.get(name.toLowerCase());
      if (!matched) {
        errors.push(
          "No matching vendor found by vendorCode or vendorName (vendors are not auto-created)",
        );
      }
      const invNum = cellAt(cells, "invoiceNumber");
      let targetInvoiceId: number | null = null;
      if (matched && invNum) {
        const key = `${matched.id}::${invNum.toLowerCase()}`;
        if (seenInvoiceKeys.has(key)) {
          errors.push("Duplicate invoice (vendor + invoiceNumber) within file");
        } else {
          seenInvoiceKeys.add(key);
        }
        const target = existingInvoiceKeys.get(key);
        if (target) {
          dbExists = true;
          targetInvoiceId = target.id;
        } else {
          errors.push(
            "No existing invoice found to correct for this vendor and invoice number (corrections only update existing invoices; they are never created)",
          );
        }
      }
      const total = cellAt(cells, "totalAmount");
      const tax = cellAt(cells, "taxAmount");
      const subtotal = cellAt(cells, "subtotal");
      entity = {
        targetInvoiceId,
        vendorId: matched?.id ?? null,
        invoiceNumber: invNum,
        invoiceDate: cellAt(cells, "invoiceDate") || null,
        poNumber: cellAt(cells, "poNumber") || null,
        subtotal: subtotal !== "" ? subtotal : null,
        taxAmount: tax !== "" ? tax : null,
        totalAmount: total !== "" ? total : null,
        currency: cellAt(cells, "currency") || null,
        paymentTerms: cellAt(cells, "paymentTerms") || null,
        dueDate: cellAt(cells, "dueDate") || null,
      };
    }

    rows.push({
      rowNumber,
      valid: errors.length === 0,
      data,
      errors,
      entity,
      dbExists,
    });
  });

  const rowCount = rows.length;
  const rowsValid = rows.filter((r) => r.valid).length;
  const rowsRejected = rowCount - rowsValid;
  const hasBlockingErrors = rowCount === 0 || rowsValid === 0;

  let errorSummary: string | null = null;
  if (rowCount === 0) {
    errorSummary = "No data rows found in file";
  } else if (rowsRejected > 0) {
    errorSummary = `${rowsRejected} of ${rowCount} row(s) have errors`;
  }

  return {
    importType,
    fileName,
    columns,
    rowCount,
    rowsValid,
    rowsRejected,
    preview: rows.map((r) => ({
      rowNumber: r.rowNumber,
      valid: r.valid,
      data: r.data,
      errors: r.errors,
    })),
    errorSummary,
    hasBlockingErrors,
    rows,
  };
}

// ─── Commit ──────────────────────────────────────────────────────────────────
export interface CommitInput {
  importType: ImportType;
  fileName: string;
  content: string;
  uploadedBy?: string | null;
  updateExisting?: boolean;
}

export interface CommitOutcome {
  blocked: boolean;
  errorSummary?: string | null;
  batch?: SerializedImportBatch;
}

export async function commitImportData(
  input: CommitInput,
): Promise<CommitOutcome> {
  const analysis = await analyzeImport(
    input.importType,
    input.fileName,
    input.content,
    { updateExisting: input.updateExisting ?? false },
  );

  if (analysis.hasBlockingErrors) {
    return {
      blocked: true,
      errorSummary: analysis.errorSummary ?? "Import has blocking validation errors",
    };
  }

  const batchId = `IMP-${input.importType}-${Date.now()}`;
  const rowErrors: ImportRowError[] = [];
  for (const r of analysis.rows) {
    for (const message of r.errors) {
      rowErrors.push({ row: r.rowNumber, message });
    }
  }

  const [batch] = await db
    .insert(importBatchTable)
    .values({
      batchId,
      importType: input.importType,
      fileName: input.fileName,
      uploadedBy: input.uploadedBy ?? null,
      rowCount: analysis.rowCount,
      rowsAccepted: analysis.rowsValid,
      rowsRejected: analysis.rowsRejected,
      status: "COMMITTED",
      errorSummary: analysis.errorSummary,
      rowErrors,
    })
    .returning();

  const importBatchRef = String(batch.id);
  const acceptedRows = analysis.rows.filter((r) => r.valid);

  if (input.importType === "VENDOR_MASTER") {
    for (const row of acceptedRows) {
      const e = row.entity as {
        vendorCode: string;
        vendorName: string;
        taxId: string | null;
        address: string | null;
        contactEmail: string | null;
        contactPhone: string | null;
        paymentTerms: string | null;
        termsDays: number | null;
      };
      if (row.dbExists && (input.updateExisting ?? false)) {
        await db
          .update(vendorIdTable)
          .set({
            vendorName: e.vendorName,
            taxId: e.taxId,
            address: e.address,
            contactEmail: e.contactEmail,
            contactPhone: e.contactPhone,
            paymentTerms: e.paymentTerms,
            termsDays: e.termsDays,
            importBatchId: importBatchRef,
          })
          .where(eq(vendorIdTable.vendorCode, e.vendorCode));
      } else {
        await db.insert(vendorIdTable).values({
          vendorCode: e.vendorCode,
          vendorName: e.vendorName,
          taxId: e.taxId,
          address: e.address,
          contactEmail: e.contactEmail,
          contactPhone: e.contactPhone,
          paymentTerms: e.paymentTerms,
          termsDays: e.termsDays,
          importBatchId: importBatchRef,
        });
      }
    }
  } else if (input.importType === "PO_REFERENCE") {
    for (const row of acceptedRows) {
      const e = row.entity as {
        poNumber: string;
        vendorCode: string | null;
        poDate: string | null;
        buyer: string | null;
        description: string | null;
        totalAmount: string | null;
        currency: string;
        status: string;
      };
      if (row.dbExists && (input.updateExisting ?? false)) {
        await db
          .update(poHeaderTable)
          .set({
            vendorCode: e.vendorCode,
            poDate: e.poDate,
            buyer: e.buyer,
            description: e.description,
            totalAmount: e.totalAmount,
            currency: e.currency,
            status: e.status,
            importBatchId: importBatchRef,
          })
          .where(eq(poHeaderTable.poNumber, e.poNumber));
      } else {
        await db.insert(poHeaderTable).values({
          poNumber: e.poNumber,
          vendorCode: e.vendorCode,
          poDate: e.poDate,
          buyer: e.buyer,
          description: e.description,
          totalAmount: e.totalAmount,
          currency: e.currency,
          status: e.status,
          importBatchId: importBatchRef,
        });
      }
    }
  } else {
    // INVOICE_CORRECTION — update existing invoices in place, matched by
    // vendor + invoiceNumber. Only provided (non-empty) fields are changed.
    // Rows without a matching existing invoice were rejected during validation,
    // so corrections never create new invoices.
    for (const row of acceptedRows) {
      const e = row.entity as {
        targetInvoiceId: number | null;
        invoiceDate: string | null;
        poNumber: string | null;
        subtotal: string | null;
        taxAmount: string | null;
        totalAmount: string | null;
        currency: string | null;
        paymentTerms: string | null;
        dueDate: string | null;
      };
      if (e.targetInvoiceId == null) continue;
      const updates: Record<string, unknown> = {};
      if (e.invoiceDate != null) updates.invoiceDate = e.invoiceDate;
      if (e.poNumber != null) updates.poNumber = e.poNumber;
      if (e.subtotal != null) updates.subtotal = e.subtotal;
      if (e.taxAmount != null) updates.taxAmount = e.taxAmount;
      if (e.totalAmount != null) updates.totalAmount = e.totalAmount;
      if (e.currency != null) updates.currency = e.currency;
      if (e.paymentTerms != null) updates.paymentTerms = e.paymentTerms;
      if (e.dueDate != null) updates.dueDate = e.dueDate;
      if (Object.keys(updates).length === 0) continue;
      await db
        .update(invoiceCaptureTable)
        .set(updates)
        .where(eq(invoiceCaptureTable.id, e.targetInvoiceId));
    }
  }

  return { blocked: false, batch: serializeBatch(batch) };
}

// ─── Serialization ───────────────────────────────────────────────────────────
export interface SerializedImportBatch {
  id: number;
  batchId: string;
  importType: string;
  fileName: string;
  uploadedBy: string | null;
  uploadedAt: string;
  rowCount: number;
  rowsAccepted: number;
  rowsRejected: number;
  status: string;
  errorSummary: string | null;
  rowErrors: ImportRowError[];
  createdAt: string;
  updatedAt: string;
}

const isoOrNull = (v: unknown): string =>
  (v instanceof Date ? v.toISOString() : String(v ?? ""));

export function serializeBatch(b: ImportBatch): SerializedImportBatch {
  return {
    id: b.id,
    batchId: b.batchId,
    importType: b.importType,
    fileName: b.fileName,
    uploadedBy: b.uploadedBy ?? null,
    uploadedAt: isoOrNull(b.uploadedAt),
    rowCount: b.rowCount,
    rowsAccepted: b.rowsAccepted,
    rowsRejected: b.rowsRejected,
    status: b.status,
    errorSummary: b.errorSummary ?? null,
    rowErrors: (b.rowErrors as ImportRowError[] | null) ?? [],
    createdAt: isoOrNull(b.createdAt),
    updatedAt: isoOrNull(b.updatedAt),
  };
}

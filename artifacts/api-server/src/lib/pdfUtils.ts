import { PDFDocument } from "pdf-lib";

/**
 * PDF helpers built on pdf-lib. Used by document detection (page count) and by
 * extraction (in-memory page-range splitting so each detected invoice is read
 * from only its own pages). The original uploaded file is never modified — all
 * operations produce new in-memory buffers.
 */

/** Number of pages in a PDF buffer. Throws if the buffer is not a valid PDF. */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Extract a 1-indexed, inclusive page range into a new PDF buffer. The range is
 * clamped to the document bounds; if the requested range is invalid or covers
 * the whole document, the original buffer is returned unchanged.
 */
export async function extractPdfPageRange(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number,
): Promise<Buffer> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();

  const start = Math.max(1, Math.min(pageStart, total));
  const end = Math.max(start, Math.min(pageEnd, total));

  // Whole-document range: nothing to split.
  if (start === 1 && end === total) {
    return buffer;
  }

  const out = await PDFDocument.create();
  const indices = [];
  for (let i = start - 1; i <= end - 1; i++) {
    indices.push(i);
  }
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return Buffer.from(bytes);
}

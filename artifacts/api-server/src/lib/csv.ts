/**
 * Shared CSV helpers with spreadsheet formula-injection protection.
 * Mirrors the escaping used by the Phase 1 invoice CSV export.
 */

/**
 * Escape a single CSV cell. Guards against formula triggers (=, +, -, @, tab, CR)
 * by prefixing a single quote, while keeping real numbers (including negatives)
 * numeric. Quotes/commas/newlines force the value to be double-quoted.
 */
export function cell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (
    typeof value !== "number" &&
    /^[=+\-@\t\r]/.test(s) &&
    !Number.isFinite(Number(s))
  ) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a header row and data rows (each a list of values). */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) {
    lines.push(row.map(cell).join(","));
  }
  return lines.join("\r\n");
}

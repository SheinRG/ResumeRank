// Spreadsheet apps evaluate a cell that starts with one of these as a formula,
// so a crafted candidate field could run code on whoever opens the export.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Escapes one cell per RFC 4180 and neutralises formula injection (OWASP). */
export function csvField(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return /["\n\r,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(values: readonly string[]): string {
  return values.map(csvField).join(",");
}

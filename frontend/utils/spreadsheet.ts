// Reading and writing spreadsheets in the browser. The spreadsheet library is loaded only when needed, so it never
// weighs on the first page load. Old-format .xls files are refused with a clear message.

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isOldExcel = (b: Uint8Array) => b.length > 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/** First column of a CSV text, one value per line (handles quoted values). */
export function firstColumnFromCsv(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value = '';
    if (line[0] === '"') {
      let i = 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2; continue; }
        if (line[i] === '"') break;
        value += line[i]; i += 1;
      }
    } else {
      value = line.split(',')[0];
    }
    value = value.trim();
    if (value) out.push(value);
  }
  return out;
}

/** The first column of the first sheet of an .xlsx or .csv file. */
export async function readFirstColumn(file: File): Promise<string[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isOldExcel(bytes)) throw new Error('Old Excel files (.xls) are not supported. Please save the file as .xlsx or .csv and try again.');
  if (!isZip(bytes)) return firstColumnFromCsv(new TextDecoder().decode(bytes));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes.buffer as ArrayBuffer); } catch { throw new Error('That file could not be read. Please use a .xlsx or .csv file.'); }
  const sheet = wb.worksheets[0];
  const out: string[] = [];
  if (!sheet) return out;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const v: any = row.getCell(1).value;
    const text = v == null ? '' : typeof v === 'object' ? (v.richText ? v.richText.map((t: any) => t.text).join('') : v.text ?? (v.result != null ? String(v.result) : '')) : String(v);
    if (text.trim()) out.push(text.trim());
  });
  return out;
}

/** Saves rows as a one-sheet .xlsx download. */
export async function downloadXlsx(rows: unknown[][], sheetName: string, fileName: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((r) => ws.addRow(r as any[]));
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

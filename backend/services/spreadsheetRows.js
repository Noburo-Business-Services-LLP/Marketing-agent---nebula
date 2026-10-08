'use strict';
// Reads the first sheet of an uploaded .xlsx or .csv into plain row objects keyed by the header row (empty cells
// become ''), like the old reader did. Old-format .xls files are refused with a clear message.
const ExcelJS = require('exceljs');
const { Readable } = require('stream');

const MAX_ROWS = 501; // header + 500 data rows

class SpreadsheetError extends Error {}

const isZip = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const isOldExcel = (b) => b.length > 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return cellText(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    return '';
  }
  return v;
}

async function readRows(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new SpreadsheetError('The file is empty.');
  if (isOldExcel(buffer)) throw new SpreadsheetError('Old Excel files (.xls) are not supported. Please save the file as .xlsx or .csv and upload it again.');
  const wb = new ExcelJS.Workbook();
  try {
    if (isZip(buffer)) await wb.xlsx.load(buffer);
    else await wb.csv.read(Readable.from([buffer]));
  } catch (e) {
    throw new SpreadsheetError('We could not read this file. Please upload a .xlsx or .csv file.');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = String(cellText(cell.value)).trim(); });
  const rows = [];
  const last = Math.min(sheet.rowCount, MAX_ROWS);
  for (let r = 2; r <= last; r += 1) {
    const row = sheet.getRow(r);
    const obj = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = cellText(row.getCell(col).value);
      if (v !== '') any = true;
      obj[h] = v;
    });
    if (any) rows.push(obj);
  }
  return rows;
}

module.exports = { readRows, SpreadsheetError };

const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { readRows, SpreadsheetError } = require('../services/spreadsheetRows');

test('reads a CSV into rows keyed by the header, empty cells as empty text', async () => {
  const rows = await readRows(Buffer.from('name,price,notes\nTea,120,\nCoffee,250,fresh\n,,\n'));
  assert.deepEqual(rows, [{ name: 'Tea', price: '120', notes: '' }, { name: 'Coffee', price: '250', notes: 'fresh' }].map((r) => ({ ...r, price: r.price })));
});

test('reads an XLSX file', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.addRow(['name', 'price']);
  ws.addRow(['Steel pan', 450]);
  ws.addRow(['Copper pot', { richText: [{ text: 'Cop' }, { text: 'per' }] }]);
  const rows = await readRows(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Steel pan');
  assert.equal(rows[0].price, 450);
  assert.equal(rows[1].name, 'Copper pot');
});

test('stops at 500 data rows', async () => {
  const csv = `a\n${Array.from({ length: 800 }, (_, i) => i + 1).join('\n')}\n`;
  assert.equal((await readRows(Buffer.from(csv))).length, 500);
});

test('refuses old .xls files and empty files with a clear message', async () => {
  await assert.rejects(() => readRows(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0])), (e) => e instanceof SpreadsheetError && /xlsx or \.csv/.test(e.message));
  await assert.rejects(() => readRows(Buffer.alloc(0)), SpreadsheetError);
});

test('a broken zip is refused, not a crash', async () => {
  await assert.rejects(() => readRows(Buffer.from('PK\u0003\u0004 not really a workbook')), SpreadsheetError);
});

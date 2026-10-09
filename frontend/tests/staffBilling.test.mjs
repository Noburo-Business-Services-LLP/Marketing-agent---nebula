import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInr, splitAmount, previewLine, STATUS_LABEL } from '../utils/staffBilling.ts';

test('money is shown in rupees with Indian grouping and two decimals', () => {
  assert.equal(formatInr(2118644), '₹21,186.44');
  assert.equal(formatInr(2500000), '₹25,000.00');
  assert.equal(formatInr(12345678900), '₹12,34,56,789.00');
  assert.equal(formatInr(99), '₹0.99');
  assert.equal(formatInr(0), '₹0.00');
  assert.equal(formatInr(100000), '₹1,000.00');
});

test('the GST split matches the owner\'s example in both modes', () => {
  assert.deepEqual(splitAmount(25000, 18, true), { exPaise: 2118644, gstPaise: 381356, totalPaise: 2500000 });
  assert.deepEqual(splitAmount(25000, 18, false), { exPaise: 2500000, gstPaise: 450000, totalPaise: 2950000 });
  assert.equal(splitAmount(0, 18, true), null);
  assert.equal(splitAmount(Number('x'), 18, false), null);
  assert.equal(previewLine(25000, 18, true), 'Net ₹21,186.44 + GST ₹3,813.56 = ₹25,000.00 a month');
  assert.equal(previewLine(25000, 18, false), 'Net ₹25,000.00 + GST ₹4,500.00 = ₹29,500.00 a month');
});

test('every status has a plain label', () => {
  for (const k of ['not_invoiced', 'invoiced', 'overdue', 'paid', 'void']) assert.ok(STATUS_LABEL[k]);
});

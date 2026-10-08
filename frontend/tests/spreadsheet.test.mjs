import test from 'node:test';
import assert from 'node:assert/strict';
import { firstColumnFromCsv } from '../utils/spreadsheet.ts';

test('first column of a CSV: plain, quoted, blank lines, byte-order mark', () => {
  assert.deepEqual(firstColumnFromCsv('﻿idea one,x\nidea two\n\n"idea, with comma",y\n"say ""hi""",z\n'), ['idea one', 'idea two', 'idea, with comma', 'say "hi"']);
  assert.deepEqual(firstColumnFromCsv(''), []);
});

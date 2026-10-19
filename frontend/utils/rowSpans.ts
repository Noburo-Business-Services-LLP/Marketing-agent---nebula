/**
 * Full rows for a tile grid (owner, 2026-10-19: "everything symmetrical, filling the width").
 *
 * Tiles keep their reading order. Each tile asks for a number of columns; when the next tile does not fit in what is
 * left of the row, the last tile of the row is widened to close the gap, and the next tile starts a new row. The last
 * row is closed the same way. So every row is completely filled and no grid cell stays empty.
 */
export function fillRows(wants: number[], cols: number): number[] {
  const c = Math.max(1, Math.floor(cols) || 1);
  const spans: number[] = [];
  let left = c;
  wants.forEach((w) => {
    const want = Math.min(c, Math.max(1, Math.floor(Number(w)) || 1));
    if (want > left) {
      spans[spans.length - 1] += left;
      left = c;
    }
    spans.push(want);
    left -= want;
    if (left === 0) left = c;
  });
  if (left !== c && spans.length) spans[spans.length - 1] += left;
  return spans;
}

/** The rows the spans make, as lists of indexes (used by the tests and the layout checks). */
export function rowsOf(spans: number[], cols: number): number[][] {
  const rows: number[][] = [];
  let used = cols;
  spans.forEach((s, i) => {
    if (used + s > cols) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(i);
    used += s;
  });
  return rows;
}

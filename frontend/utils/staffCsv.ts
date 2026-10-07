/** The clients CSV for the staff area. Pure, so it is tested without a screen. */
export const STATUS_TEXT: Record<string, string> = { active: 'Active', inactive: 'Inactive', disabled: 'Switched off' };

/**
 * One quoted cell. Client names are typed by customers, so a value that starts with = + - @ (or a tab or
 * line break) would be run as a formula when the file is opened in a spreadsheet; a leading apostrophe
 * keeps it as plain text.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** `labels` supplies the plain names (plan and network), so this file needs no imports. */
export function toCsv(rows: Array<any>, labels: { tier: Record<string, string>; platform: (key: string) => string }): string {
  const head = ['Name', 'Email', 'Plan', 'Paying', 'Quarks', 'Connected accounts', 'CSM', 'Last active', 'Status'];
  const lines = rows.map((r) => [
    r.name, r.email, labels.tier[r.tier] || r.tier, r.paying ? 'Yes' : 'No', r.quarks,
    (r.platforms || []).map(labels.platform).join(', '), r.csm?.name || '', r.lastActiveAt || '', STATUS_TEXT[r.status] || r.status
  ].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\n');
}

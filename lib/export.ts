import type { GitHubPR } from './db';

// Escape CSV field (handle commas, quotes, newlines)
function escapeCSVField(value: string | number | null): string {
  if (value === null || value === undefined) return '';

  const str = String(value);

  // If contains comma, quote, or newline, wrap in quotes and escape existing quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

// Export GitHub PRs to CSV format
export function exportPRsToCSV(prs: GitHubPR[]): string {
  const headers = [
    'PR Number',
    'Title',
    'Description',
    'Repository',
    'URL',
    'State',
    'Created Date',
    'Merged Date',
    'Lines Added',
    'Lines Deleted',
    'Total Lines Changed',
  ];

  const rows = prs.map((pr) => [
    pr.number,
    escapeCSVField(pr.title),
    escapeCSVField(pr.body),
    escapeCSVField(pr.repo),
    escapeCSVField(pr.url),
    escapeCSVField(pr.state),
    new Date(pr.createdAt).toISOString().split('T')[0],
    pr.mergedAt ? new Date(pr.mergedAt).toISOString().split('T')[0] : '',
    pr.additions,
    pr.deletions,
    pr.additions + pr.deletions,
  ]);

  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => escapeCSVField(cell)).join(',')),
  ].join('\n');

  return csvContent;
}

// Trigger CSV download in browser
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Helper to generate timestamped filename
export function generateExportFilename(prefix: string = 'github-prs'): string {
  const date = new Date().toISOString().split('T')[0];
  return `${prefix}-${date}.csv`;
}

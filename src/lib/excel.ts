import * as XLSX from 'xlsx';
import type { PrepField, Segment } from './types';

export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
  isLikelyMainline: boolean;
}

export interface ParsedExcel {
  headers: string[];
  headerRowIndex: number;
  rows: string[][];
  sheetName: string;
}

/**
 * List all sheets in a workbook with metadata so the user can pick one.
 */
export function listSheets(buffer: ArrayBuffer): SheetInfo[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1, raw: false, defval: '', blankrows: true,
    });
    const rowCount = data.length;
    const colCount = data[0]?.length ?? 0;
    // Auto-detect: name contains "mainline" or row 1 contains "mainline liner"
    const nameLower = name.toLowerCase();
    const row1Text = (data[0] ?? []).map((c: any) => String(c).toLowerCase()).join(' ');
    const isLikelyMainline =
      nameLower.includes('mainline') ||
      row1Text.includes('mainline liner') ||
      row1Text.includes('mainline tracking');
    return { name, rowCount, colCount, isLikelyMainline };
  });
}

/**
 * Parse an Excel file — detect the header row (row 3 by spec, but auto-detect fallback)
 * @param sheetName — which sheet tab to parse. If omitted, uses the first sheet.
 */
export function parseExcelFile(buffer: ArrayBuffer, sheetName?: string): ParsedExcel {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const targetSheet = sheetName ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheet];

  // Convert to array of arrays (all cells as strings)
  const rawData: (string | number | boolean | Date | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });

  if (rawData.length === 0) throw new Error('Spreadsheet appears to be empty.');

  // Detect header row: the spec says Row 3 (index 2) is the actual column header row.
  // Default to row 3 always. Only fall back to auto-detect if row 3 has fewer than 5
  // non-empty cells (e.g. a division's sheet where headers live on row 1 or row 2).
  // If even the fallback produces a row with < 3 non-empty cells, throw — silently
  // parsing garbage headers leads to blank segments and blank PDFs with no warning.
  const countNonEmpty = (row: (string | number | boolean | Date | null)[] | undefined) =>
    (row ?? []).filter(c => c !== '' && c !== null && c !== undefined).length;

  let headerRowIndex = 2; // row 3 (0-indexed) per spec
  const row3NonEmpty = countNonEmpty(rawData[2]);

  if (row3NonEmpty < 5) {
    // Fall back to picking the row with the most non-empty cells in the first 10 rows
    let bestIndex = 0;
    let bestNonEmpty = countNonEmpty(rawData[0]);
    for (let i = 1; i < Math.min(10, rawData.length); i++) {
      const n = countNonEmpty(rawData[i]);
      if (n > bestNonEmpty) {
        bestNonEmpty = n;
        bestIndex = i;
      }
    }
    if (bestNonEmpty < 3) {
      throw new Error(
        `Could not locate a header row: row 3 has ${row3NonEmpty} non-empty cells and the ` +
        `best alternative in the first 10 rows has only ${bestNonEmpty}. Check the spreadsheet ` +
        `structure — the header row should have at least 3 column labels.`
      );
    }
    headerRowIndex = bestIndex;
  }

  const headerRow = rawData[headerRowIndex] || [];
  const headers = headerRow.map(c => (c === null || c === undefined ? '' : String(c).trim()));

  // Data rows start after header row
  const rows: string[][] = rawData
    .slice(headerRowIndex + 1)
    .map(row => row.map(c => (c === null || c === undefined ? '' : String(c).trim())));

  return { headers, headerRowIndex, rows, sheetName: targetSheet };
}

/**
 * Parse Excel rows into Segment objects using a column mapping.
 * @param fallbackColumns - optional per-field fallback column indices.
 *   If the primary mapping column is empty for a row, the fallback column is tried.
 *   Useful for pipeLength: CCTV Length (primary) → Plan Length (fallback).
 */
export function rowsToSegments(
  rows: string[][],
  mapping: Record<PrepField, number | null>,
  fallbackColumns?: Partial<Record<PrepField, number | null>>
): Segment[] {
  const segments: Segment[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue; // skip blank rows

    const get = (field: PrepField): string => {
      const col = mapping[field];
      if (col !== null && col !== undefined) {
        const val = row[col] ?? '';
        if (val) return val;
      }
      // Try fallback column
      const fb = fallbackColumns?.[field];
      if (fb !== null && fb !== undefined) {
        return row[fb] ?? '';
      }
      return '';
    };

    const repairNumber = get('repairNumber');
    if (!repairNumber) continue; // skip rows without a repair number

    // Parse date — handles MM/DD/YY, MM/DD/YYYY, and typos like MM/DD/226
    const dateStr = get('date');
    let parsedDate: Date | null = null;
    if (dateStr) {
      parsedDate = parseFlexibleDate(dateStr);
    }

    // Determine readyToLine from status column
    const statusVal = get('readyToLine').toLowerCase();
    const readyToLine = statusVal.includes('ready') || statusVal === 'yes' || statusVal === 'y';

    // Combine comments
    const c1 = get('comments1');
    const c2 = get('comments2');
    const comments = [c1, c2].filter(Boolean).join(' | ');

    // Build raw record for debugging/mapping display
    const raw: Record<string, string> = {};
    row.forEach((val, idx) => { raw[idx] = val; });

    segments.push({
      rowIndex: i,
      repairNumber,
      date: parsedDate,
      dateStr,
      pipeSize: get('pipeSize'),
      pipeLength: get('pipeLength'),
      streetName: get('streetName'),
      usDepth: get('usDepth'),
      dsDepth: get('dsDepth'),
      mhFrom: get('mhFrom'),
      mhTo: get('mhTo'),
      readyToLine,
      comments,
      pipeMaterial: get('pipeMaterial'),
      sheetNumber: get('sheetNumber'),
      raw,
    });
  }

  return segments;
}

/**
 * Get unique weeks from segments for date range filter
 */
export function getWeekRanges(segments: Segment[]): Array<{ label: string; start: Date; end: Date }> {
  const weeks = new Map<string, { start: Date; end: Date }>();

  for (const seg of segments) {
    if (!seg.date) continue;
    const d = seg.date;
    // Get Monday of the week
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const key = monday.toISOString().slice(0, 10);
    if (!weeks.has(key)) {
      weeks.set(key, { start: monday, end: sunday });
    }
  }

  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, range]) => ({
      label: `${fmtDate(range.start)} – ${fmtDate(range.end)}`,
      start: range.start,
      end: range.end,
    }));
}

/**
 * Parse dates flexibly — handles MM/DD/YY, MM/DD/YYYY, and typos like MM/DD/226.
 * SheetJS with raw:false may output "4/3/26" for 2026 dates.
 * Also handles ISO strings and other Date()-parseable formats.
 */
function parseFlexibleDate(s: string): Date | null {
  // Try MM/DD/YY or MM/DD/YYYY pattern first
  const parts = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{1,4})$/);
  if (parts) {
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    let year = parseInt(parts[3], 10);
    // Normalize year: 0-99 → 2000-2099, 100-999 → assume typo (add 1800 to get close to 2000s)
    if (year < 100) {
      year += 2000;
    } else if (year >= 100 && year < 1900) {
      // Likely a typo like "226" meaning "2026" — try to recover
      // Check if removing extra leading digits gives a 2-digit year that makes sense
      const yearStr = parts[3];
      const last2 = parseInt(yearStr.slice(-2), 10);
      year = 2000 + last2;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2099) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback: try native Date parsing
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    // Guard against ancient years from misparse
    if (d.getFullYear() < 2000 || d.getFullYear() > 2099) return null;
    return d;
  }

  return null;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

import type { PrepField } from './types';

// Preferred aliases: when multiple columns match the same field, prefer these
// (e.g., "CCTV Length" should win over "Plan Length" for pipeLength)
const PREFERRED_ALIASES: Partial<Record<PrepField, string[]>> = {
  pipeLength: ['cctv length', 'tv length', 'measured length', 'actual length'],
  date: ['pre cctv date', 'cctv date', 're cctv date', 'pre tv date', 'inspection date'],
};

// Candidate aliases for each field — lower-cased, normalized
const FIELD_ALIASES: Record<PrepField, string[]> = {
  date: [
    'pre cctv date', 'cctv date', 're cctv date', 'recctv date',
    'inspection date', 'date', 'pre-tv date', 'tv date',
    'pre cctv', 're cctv', 'survey date', 'field date',
  ],
  repairNumber: [
    'cwn item no', 'cwn item number', 'repair #', 'repair number', 'repair no',
    'psr', 'segment id', 'segment no', 'segment number', 'item no', 'item number',
    'job item', 'work order',
  ],
  pipeSize: [
    'pipe dia', 'pipe diameter', 'pipe size', 'size', 'diameter', 'pipe dia.',
    'nominal size', 'pipe diam',
  ],
  pipeLength: [
    'cctv length', 'plan length', 'pipe length', 'length', 'segment length',
    'measured length', 'actual length', 'tv length',
  ],
  streetName: ['street name', 'street', 'road name', 'road', 'address', 'location'],
  usDepth: [
    'us mh depth', 'u.s. depth', 'upstream depth', 'us depth', 'usmh depth',
    'upstream mh depth', 'u/s depth', 'us mh dep',
  ],
  dsDepth: [
    'ds mh depth', 'd.s. depth', 'downstream depth', 'ds depth', 'dsmh depth',
    'downstream mh depth', 'd/s depth', 'ds mh dep',
  ],
  mhFrom: [
    'usmh', 'us mh', 'upstream mh', 'u.s.m.h', 'from mh', 'from manhole',
    'upstream manhole', 'us manhole', 'up mh', 'usmh id',
  ],
  mhTo: [
    'dsmh', 'ds mh', 'downstream mh', 'd.s.m.h', 'to mh', 'to manhole',
    'downstream manhole', 'ds manhole', 'dn mh', 'dsmh id',
  ],
  readyToLine: [
    'status', 'ready to line', 'ready', 'line status', 'lining status',
    'rehab status', 'r2l', 'r-2-l',
  ],
  comments1: [
    'pre-tv notes', 'pre tv notes', 'pretv notes', 'pre-cctv notes',
    'pre cctv notes', 'pre cctv comments', 'pre-cctv comments',
    'pretv comments', 'pre tv comments', 'tv notes', 'field notes', 'notes',
  ],
  comments2: [
    'comments', 'comment', 'remarks', 'additional comments', 'notes',
    'general comments',
  ],
  pipeMaterial: [
    'existing pipe material', 'pipe material', 'material', 'pipe type',
    'existing material', 'pipe mat', 'lining material',
  ],
  sheetNumber: [
    // Sheet variants
    'sheet no', 'sheet number', 'sheet #', 'sheet', 'sheets', 'sheet ref',
    'sheet nos', 'sheet numbers', 'plan sheet', 'plan sheets', 'plan sheet no',
    // Drawing variants
    'drawing no', 'drawing number', 'drawing #', 'drawing', 'drawings',
    'dwg no', 'dwg number', 'dwg #', 'dwg', 'dwgs', 'draw no', 'drw no',
    // Map variants
    'map no', 'map number', 'map #', 'map', 'maps', 'map page', 'map pages',
    'map pg', 'map sheet', 'map sheets',
    // Plan/page variants
    'plan no', 'plan number', 'plan #', 'plan page', 'plan pages', 'plan pg',
    'plans', 'page', 'pages', 'pg no', 'pg number', 'pg #',
    // Construction/as-built variants
    'contract dwg', 'contract drawing', 'contract sheet',
    'asbuilt sheet', 'as built sheet', 'as-built sheet',
    'reference sheet', 'plate no', 'plate number', 'plate',
  ],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[._\-/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  // Token overlap
  const tokA = new Set(a.split(' ').filter(Boolean));
  const tokB = new Set(b.split(' ').filter(Boolean));
  const intersect = [...tokA].filter(t => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  return union === 0 ? 0 : intersect / union;
}

export interface FuzzyMatch {
  field: PrepField;
  score: number;
  matchedAlias: string;
}

export function matchColumn(header: string): FuzzyMatch | null {
  const norm = normalize(header);
  let best: FuzzyMatch | null = null;

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [PrepField, string[]][]) {
    for (const alias of aliases) {
      const score = similarity(norm, alias);
      if (score > (best?.score ?? 0.4)) {
        best = { field, score, matchedAlias: alias };
      }
    }
  }

  return best;
}

export type AutoMapping = Partial<Record<PrepField, number>>;

// Fallback aliases: when these aliases match, they become per-row fallbacks
// (e.g., if CCTV Length is empty on a row, fall back to Plan Length)
const FALLBACK_ALIASES: Partial<Record<PrepField, string[]>> = {
  pipeLength: ['plan length', 'pipe length', 'segment length'],
};

export function autoMapColumns(headers: string[]): {
  confident: AutoMapping;
  uncertain: Array<{ headerIndex: number; header: string; match: FuzzyMatch | null }>;
  fallbacks: Partial<Record<PrepField, number>>;
} {
  const confident: AutoMapping = {};
  const uncertain: Array<{ headerIndex: number; header: string; match: FuzzyMatch | null }> = [];
  const fallbacks: Partial<Record<PrepField, number>> = {};
  const usedFields = new Set<PrepField>();

  // First pass: collect ALL confident matches per field (score >= 0.75)
  const candidatesByField = new Map<PrepField, Array<{ index: number; match: FuzzyMatch }>>();

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header?.trim()) continue;
    const match = matchColumn(header);
    if (match && match.score >= 0.75) {
      if (!candidatesByField.has(match.field)) {
        candidatesByField.set(match.field, []);
      }
      candidatesByField.get(match.field)!.push({ index: i, match });
    }
  }

  // Resolve each field: prefer aliases from PREFERRED_ALIASES, else first/highest score
  // Also set fallback columns for fields with FALLBACK_ALIASES
  for (const [field, candidates] of candidatesByField) {
    const preferred = PREFERRED_ALIASES[field];
    const fallbackAliases = FALLBACK_ALIASES[field];
    let chosen = candidates[0]; // default to first

    if (preferred && candidates.length > 1) {
      // Check if any candidate matches a preferred alias
      const preferredCandidate = candidates.find(c =>
        preferred.includes(c.match.matchedAlias)
      );
      if (preferredCandidate) chosen = preferredCandidate;
    }

    confident[field] = chosen.index;
    usedFields.add(field);

    // Set fallback: find a non-chosen candidate that matches a fallback alias
    if (fallbackAliases && candidates.length > 1) {
      const fallbackCandidate = candidates.find(c =>
        c.index !== chosen.index && fallbackAliases.includes(c.match.matchedAlias)
      );
      if (fallbackCandidate) {
        fallbacks[field] = fallbackCandidate.index;
      } else {
        // Use the first non-chosen candidate as fallback
        const other = candidates.find(c => c.index !== chosen.index);
        if (other) fallbacks[field] = other.index;
      }
    }
  }

  // Second pass: uncertain (0.4-0.75 score, or field not yet mapped)
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header?.trim()) continue;
    const match = matchColumn(header);
    if (!match || match.score < 0.4) {
      // Completely unrecognized — skip
      continue;
    }
    if (match.score < 0.75 || (match && usedFields.has(match.field) && confident[match.field] !== i)) {
      uncertain.push({ headerIndex: i, header, match });
    }
  }

  return { confident, uncertain, fallbacks };
}

export function fingerprintHeaders(headers: string[]): string {
  // Create a stable fingerprint from the non-empty headers
  const normalized = headers
    .filter(Boolean)
    .map(h => normalize(h))
    .join('|');
  // Simple hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

// ----------- Mapping Health Check -----------

export interface MappingWarning {
  field: PrepField;
  fillRate: number;
  currentColumn: number | null;
  suggestion: { columnIndex: number; header: string; sampleValues: string[] } | null;
}

const HEALTH_CHECK_FIELDS: PrepField[] = [
  'sheetNumber', 'pipeSize', 'pipeLength', 'pipeMaterial', 'usDepth', 'dsDepth',
];

/**
 * After mapping is applied, check which fields are poorly populated.
 * For key fields, attempt value-pattern matching to suggest the correct column.
 */
export function checkMappingHealth(
  segments: Array<Record<string, any>>,
  mapping: Record<PrepField, number | null>,
  headers: string[],
  rows: string[][],
): MappingWarning[] {
  if (segments.length === 0) return [];

  const warnings: MappingWarning[] = [];
  const mappedCols = new Set(
    Object.values(mapping).filter((v): v is number => v != null)
  );

  for (const field of HEALTH_CHECK_FIELDS) {
    const colIdx = mapping[field];

    let filled = 0;
    for (const seg of segments) {
      const val = seg[field];
      if (val != null && String(val).trim() !== '') filled++;
    }
    const rate = filled / segments.length;
    if (rate > 0.3) continue; // 30%+ populated = fine

    let suggestion: MappingWarning['suggestion'] = null;
    if (field === 'sheetNumber') {
      suggestion = suggestByPattern(headers, rows, mappedCols, scoreSheetNumber);
    }

    // Surface warning for key fields or when we have a suggestion
    if (field === 'sheetNumber' || suggestion) {
      warnings.push({ field, fillRate: rate, currentColumn: colIdx ?? null, suggestion });
    }
  }
  return warnings;
}

function suggestByPattern(
  headers: string[],
  rows: string[][],
  mapped: Set<number>,
  scorer: (vals: string[]) => number,
): MappingWarning['suggestion'] {
  let best = 0;
  let bestIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    if (mapped.has(i)) continue;
    const vals = rows.slice(0, 30).map(r => (r[i] ?? '').trim()).filter(Boolean);
    if (vals.length < 3) continue;
    const s = scorer(vals);
    if (s > best) { best = s; bestIdx = i; }
  }

  if (bestIdx >= 0 && best >= 0.5) {
    const samples = rows.slice(0, 6).map(r => (r[bestIdx] ?? '').trim()).filter(Boolean);
    return { columnIndex: bestIdx, header: headers[bestIdx], sampleValues: samples };
  }
  return null;
}

/** Score how likely a set of values are sheet numbers (0-1) */
function scoreSheetNumber(values: string[]): number {
  let hits = 0;
  for (const v of values) {
    if (v.length > 10) continue;
    if (/^\d{1,3}$/.test(v) || /^\d{1,3}\/\d{1,3}/.test(v) ||
        /^[A-Za-z]\d{1,3}$/.test(v) || /^[A-Za-z0-9]{1,3}-[A-Za-z0-9]{1,3}$/.test(v)) {
      hits++;
    }
  }
  return values.length > 0 ? hits / values.length : 0;
}

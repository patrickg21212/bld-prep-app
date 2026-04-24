// Core types for BLD Prep Sheet App

export interface AnnotationData {
  id: string;
  type: 'circle' | 'text';
  x: number;
  y: number;
  radiusX?: number;
  radiusY?: number;
  rotation?: number;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
  fontSize?: number;
  fill?: string;
}

export interface ColumnMapping {
  id?: number;
  fingerprint: string; // hash of header row
  mapping: Record<PrepField, number | null>; // PrepField -> column index
  fallbacks?: Partial<Record<PrepField, number | null>>; // per-row fallback columns
  savedAt: number;
}

export type PrepField =
  | 'date'
  | 'repairNumber'
  | 'pipeSize'
  | 'pipeLength'
  | 'streetName'
  | 'usDepth'
  | 'dsDepth'
  | 'mhFrom'
  | 'mhTo'
  | 'readyToLine'
  | 'comments1'
  | 'comments2'
  | 'pipeMaterial'
  | 'sheetNumber';

export const PREP_FIELD_LABELS: Record<PrepField, string> = {
  date: 'DATE',
  repairNumber: 'REPAIR #',
  pipeSize: 'PIPE SIZE',
  pipeLength: 'PIPE LENGTH',
  streetName: 'STREET NAME',
  usDepth: 'USMH DEPTH',
  dsDepth: 'DSMH DEPTH',
  mhFrom: 'USMH',
  mhTo: 'DSMH',
  readyToLine: 'READY TO LINE',
  comments1: 'COMMENTS (Pre-TV Notes)',
  comments2: 'COMMENTS (Other)',
  pipeMaterial: 'PIPE MATERIAL',
  sheetNumber: 'SHEET #',
};

export interface Segment {
  rowIndex: number;
  repairNumber: string;
  date: Date | null;
  dateStr: string;
  pipeSize: string;
  pipeLength: string;
  streetName: string;
  usDepth: string;
  dsDepth: string;
  mhFrom: string;
  mhTo: string;
  readyToLine: boolean;
  comments: string;
  pipeMaterial: string;
  sheetNumber: string;
  raw: Record<string, string>;
}

export type WaterFlow = 'LIGHT' | 'MEDIUM' | 'HIGH' | '';
export type MhLocation = 'STREET' | 'EASEMENT' | '';

// Every Segment-derived field that can appear on the PDF gets an override key.
// Worker can edit any spreadsheet-sourced value on the prep sheet without
// touching the Excel file. Stored in observations.fieldOverrides.
export type SegmentFieldKey =
  | 'dateStr'
  | 'repairNumber'
  | 'pipeSize'
  | 'pipeLength'
  | 'pipeMaterial'
  | 'streetName'
  | 'usDepth'
  | 'dsDepth'
  | 'mhFrom'
  | 'mhTo'
  | 'sheetNumber'
  | 'comments';

export interface SegmentObservations {
  waterFlow: WaterFlow;
  overheadLines: boolean | null;
  infiltration: boolean | null;
  needsPointRepair: boolean | null;
  readyToLine: boolean | null;
  incomingLinesSize: string;
  mhLocation: MhLocation;
  addressUSMH: string;
  addressDSMH: string;
  blowToilets: boolean | null;
  toiletAddresses: string;
  notes: string;
  // Per-segment manual overrides for fields that came from the spreadsheet.
  // Useful when the sheet is incomplete (e.g., missing PIPE SIZE) — worker
  // types the correct value on the prep sheet without editing the Excel.
  fieldOverrides?: Partial<Record<SegmentFieldKey, string>>;
}

export interface SegmentDraft {
  id?: number;
  projectId: string;
  segmentId: string;
  observations: SegmentObservations;
  mapImageDataUrl?: string;       // composited export (image + annotations) for PDF
  mapRawImageDataUrl?: string;    // raw uploaded image (for re-initializing editor)
  mapAnnotations?: AnnotationData[];
  savedAt: number;
}

export interface ProjectDefaults {
  id?: number;
  projectId: string;
  jobNumber: string;
  jobName: string;
  savedAt: number;
}

export interface AppProject {
  id: string;
  name: string;
  fileName: string;
  segments: Segment[];
  columnMapping: Record<PrepField, number | null>;
  fallbackColumns?: Partial<Record<PrepField, number | null>>;
  columnHeaders: string[];
  savedAt: number;
  // True when this project was created without a spreadsheet.
  // Segments are added manually via the "Add Segment" button.
  isManualProject?: boolean;
}

export const DEFAULT_OBSERVATIONS: SegmentObservations = {
  waterFlow: '',
  overheadLines: null,
  infiltration: null,
  needsPointRepair: null,
  readyToLine: null,
  incomingLinesSize: '',
  mhLocation: '',
  addressUSMH: '',
  addressDSMH: '',
  blowToilets: null,
  toiletAddresses: '',
  notes: '',
};

/**
 * Create a blank Segment for manual (no-spreadsheet) projects. All fields
 * empty — worker fills them in via SegmentEditor.
 */
export function createBlankSegment(repairNumber: string, rowIndex: number): Segment {
  return {
    rowIndex,
    repairNumber,
    date: null,
    dateStr: '',
    pipeSize: '',
    pipeLength: '',
    streetName: '',
    usDepth: '',
    dsDepth: '',
    mhFrom: '',
    mhTo: '',
    readyToLine: false,
    comments: '',
    pipeMaterial: '',
    sheetNumber: '',
    raw: {},
  };
}

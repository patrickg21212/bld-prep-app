import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { PrepField, Segment, SegmentObservations, AppProject, AnnotationData } from '../lib/types';
import { DEFAULT_OBSERVATIONS, createBlankSegment } from '../lib/types';
import { parseExcelFile, rowsToSegments, getWeekRanges, listSheets } from '../lib/excel';
import type { SheetInfo } from '../lib/excel';
import { autoMapColumns, fingerprintHeaders, checkMappingHealth, type MappingWarning } from '../lib/fuzzy';
import { db, getSavedMapping, saveMapping, saveDraft, getDraft, getProjectDefaults, saveProjectDefaults, getRecentProjects, savePlans, getPlans } from '../lib/db';

// Load pdf.js from CDN via script tag (UMD build sets window.pdfjsLib)
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs(): Promise<any> {
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) { reject(new Error('pdf.js not found')); return; }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      resolve(lib);
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

import HomeScreen from './HomeScreen';
import SheetPicker from './SheetPicker';
import ColumnMapper from './ColumnMapper';
import ProjectSettings from './ProjectSettings';
import SegmentList from './SegmentList';
import SegmentEditor from './SegmentEditor';
import PdfPreview from './PdfPreview';
import BatchExport from './BatchExport';

type Screen = 'home' | 'sheetpicker' | 'mapping' | 'settings' | 'segments' | 'editor' | 'preview' | 'batch';

interface MapState {
  imageDataUrl: string | null;      // composited export (for PDF)
  rawImageDataUrl: string | null;   // raw uploaded image (for editor re-init)
  annotations: AnnotationData[];
}

interface PendingFile {
  buffer: ArrayBuffer;
  fileName: string;
  sheets: SheetInfo[];
}

interface PendingMapping {
  headers: string[];
  rows: string[][];
  fileName: string;
  fingerprint: string;
  confident: Partial<Record<PrepField, number>>;
  uncertain: Array<{ headerIndex: number; header: string; match: any }>;
  fallbacks: Partial<Record<PrepField, number>>;
}

export default function App() {
  // MANDATORY: every page load = clean slate. BLD techs use spreadsheets
  // with different column formats within minutes of each other; any saved
  // mapping/draft from a prior sheet will corrupt the next one. Refresh
  // must wipe all persisted data. This blocks render until the wipe finishes.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await Promise.all([
          db.columnMappings.clear(),
          db.segmentDrafts.clear(),
          db.projectDefaults.clear(),
          db.projects.clear(),
          db.projectPlans.clear(),
        ]);
      } catch (err) {
        console.warn('[BLD] IndexedDB wipe error (proceeding anyway):', err);
      }
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch {
        // storage access errors in private-browsing modes — ignore
      }
      setReady(true);
    })();
  }, []);

  const [screen, setScreen] = useState<Screen>('home');
  const [project, setProject] = useState<AppProject | null>(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [observations, setObservations] = useState<Record<string, SegmentObservations>>({});
  const [mapData, setMapData] = useState<Record<string, MapState>>({});
  const [jobNumber, setJobNumber] = useState('');
  const [jobName, setJobName] = useState('');
  const [dateFilter, setDateFilter] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [recentProjects, setRecentProjects] = useState<AppProject[]>([]);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [pendingMapping, setPendingMapping] = useState<PendingMapping | null>(null);
  // Plans PDF is NOT held in App state. ArrayBuffers for engineering plans
  // can be 20-50MB and never need to be in memory unless the plan viewer is
  // open. plansAvailable + plansFileName + plansNumPages are small metadata
  // kept here; the actual buffer lives in IndexedDB and is fetched on-demand
  // by SegmentEditor via getPlanBuffer. This is the architectural fix for
  // the repeating crashes during multi-segment crop sessions.
  const [plansAvailable, setPlansAvailable] = useState(false);
  const [plansFileName, setPlansFileName] = useState<string | null>(null);
  const [plansNumPages, setPlansNumPages] = useState(0);
  const [mappingWarnings, setMappingWarnings] = useState<MappingWarning[]>([]);

  // Operator starts empty every refresh (no persistence — refresh = clean slate).
  const [operator, setOperatorState] = useState<string>('');
  const setOperator = useCallback((val: string) => {
    // In-memory only — refresh clears everything including operator name.
    setOperatorState(val);
  }, []);

  // Force-remap flag: bypasses saved mapping fingerprint so column mapper runs again
  const forceRemapRef = useRef(false);

  // Refs to avoid stale closures
  const projectRef = useRef(project);
  projectRef.current = project;
  const observationsRef = useRef(observations);
  observationsRef.current = observations;
  const mapDataRef = useRef(mapData);
  mapDataRef.current = mapData;
  const pendingFileRef = useRef(pendingFile);
  pendingFileRef.current = pendingFile;
  const pendingMappingRef = useRef(pendingMapping);
  pendingMappingRef.current = pendingMapping;
  const rawRowsRef = useRef<string[][]>([]);

  // Recent projects list disabled — refresh always clears everything,
  // there is nothing to show.

  // Process a specific sheet from a buffer
  const processSheet = useCallback(async (buffer: ArrayBuffer, fileName: string, sheetName: string) => {
    try {
      console.log('[BLD] processSheet:', sheetName);
      const { headers, rows } = parseExcelFile(buffer, sheetName);
      console.log('[BLD] Parsed:', headers.length, 'headers,', rows.length, 'rows');
      const fingerprint = fingerprintHeaders(headers);
      const savedMap = await getSavedMapping(fingerprint);

      if (savedMap && !forceRemapRef.current) {
        console.log('[BLD] Found saved mapping, skipping to settings');
        forceRemapRef.current = false;
        const { confident, fallbacks: fb } = autoMapColumns(headers);
        // Patch saved mapping: auto-fill any fields added after this mapping was originally saved
        const patchedMapping = { ...savedMap.mapping } as Record<PrepField, number | null>;
        for (const [field, colIdx] of Object.entries(confident) as [PrepField, number][]) {
          if (patchedMapping[field] == null) {
            patchedMapping[field] = colIdx;
            console.log(`[BLD] Auto-patched missing field '${field}' → col ${colIdx}`);
          }
        }
        const segments = rowsToSegments(rows, patchedMapping, fb);
        rawRowsRef.current = rows;
        const warnings = checkMappingHealth(segments, patchedMapping, headers, rows);
        const projectId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const proj: AppProject = {
          id: projectId,
          name: fileName.replace(/\.(xlsx|xls|csv)$/i, ''),
          fileName,
          segments,
          columnMapping: patchedMapping,
          fallbackColumns: fb,
          columnHeaders: headers,
          savedAt: Date.now(),
        };
        const defaults = await getProjectDefaults(projectId);
        setProject(proj);
        setMappingWarnings(warnings);
        setObservations({});
        setMapData({});
        setPendingFile(null);
        setPendingMapping(null);
        setJobNumber(defaults?.jobNumber ?? '');
        setJobName(defaults?.jobName ?? '');
        setDateFilter({ start: null, end: null });
        setSelectedSegments(new Set());
        setScreen('settings');
      } else {
        console.log('[BLD] No saved mapping, showing column mapper');
        const { confident, uncertain, fallbacks } = autoMapColumns(headers);
        console.log('[BLD] Confident fields:', Object.keys(confident).length, 'Uncertain:', uncertain.length);
        setPendingFile(null);
        setPendingMapping({ headers, rows, fileName, fingerprint, confident, uncertain, fallbacks });
        setScreen('mapping');
      }
    } catch (err) {
      console.error('[BLD] processSheet error:', err);
      alert('Error processing sheet: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer();
    const sheets = listSheets(buffer);

    if (sheets.length === 1) {
      await processSheet(buffer, file.name, sheets[0].name);
      return;
    }

    // Multiple sheets — show picker
    setPendingFile({ buffer, fileName: file.name, sheets });
    setScreen('sheetpicker');
  }, [processSheet]);

  const handleSheetSelect = useCallback(async (sheetName: string) => {
    console.log('[BLD] handleSheetSelect:', sheetName);
    const pf = pendingFileRef.current;
    if (!pf) {
      console.error('[BLD] handleSheetSelect: pendingFile is null!');
      return;
    }
    await processSheet(pf.buffer, pf.fileName, sheetName);
  }, [processSheet]);

  const handleMappingComplete = useCallback(async (mapping: Record<PrepField, number | null>) => {
    try {
      console.log('[BLD] handleMappingComplete called');
      const pm = pendingMappingRef.current;
      if (!pm) {
        console.error('[BLD] handleMappingComplete: pendingMapping is null!');
        return;
      }
      const { fingerprint, headers, rows, fileName, fallbacks } = pm;

      console.log('[BLD] Saving mapping...');
      await saveMapping({ fingerprint, mapping, fallbacks, savedAt: Date.now() });
      console.log('[BLD] Mapping saved, building segments...');

      const segments = rowsToSegments(rows, mapping, fallbacks);
      rawRowsRef.current = rows;
      const warnings = checkMappingHealth(segments, mapping, headers, rows);
      console.log('[BLD] Built', segments.length, 'segments');
      const projectId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const proj: AppProject = {
        id: projectId,
        name: fileName.replace(/\.(xlsx|xls|csv)$/i, ''),
        fileName,
        segments,
        columnMapping: mapping,
        fallbackColumns: fallbacks,
        columnHeaders: headers,
        savedAt: Date.now(),
      };

      setProject(proj);
      setMappingWarnings(warnings);
      setPendingMapping(null);
      setObservations({});
      setMapData({});
      setJobNumber('');
      setJobName('');
      setDateFilter({ start: null, end: null });
      setSelectedSegments(new Set());
      setScreen('settings');
      console.log('[BLD] Navigated to settings screen');
    } catch (err) {
      console.error('[BLD] handleMappingComplete error:', err);
      alert('Error saving mapping: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const handleRemapUpload = useCallback(async (file: File) => {
    forceRemapRef.current = true;
    await handleFileUpload(file);
  }, [handleFileUpload]);

  const handleFixMapping = useCallback(async (field: PrepField, columnIndex: number) => {
    const proj = projectRef.current;
    if (!proj) return;
    const rows = rawRowsRef.current;
    if (rows.length === 0) return;

    const updatedMapping = { ...proj.columnMapping, [field]: columnIndex };
    const fb = proj.fallbackColumns ?? {};
    const segments = rowsToSegments(rows, updatedMapping, fb);
    const fingerprint = fingerprintHeaders(proj.columnHeaders);
    await saveMapping({ fingerprint, mapping: updatedMapping, fallbacks: fb, savedAt: Date.now() });

    const updatedProject: AppProject = { ...proj, segments, columnMapping: updatedMapping };
    setProject(updatedProject);

    const warnings = checkMappingHealth(segments, updatedMapping, proj.columnHeaders, rows);
    setMappingWarnings(warnings);
  }, []);

  const handlePlansUpload = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      // pdf.js v3 can transfer/detach the underlying ArrayBuffer. Slice once
      // for the page-count probe, once for IndexedDB persistence. We DON'T
      // keep the buffer in React state — SegmentEditor fetches it from IDB
      // on-demand only while the plan viewer is open.
      const pdfjsBuffer = buffer.slice(0);
      const storageBuffer = buffer.slice(0);

      const lib = await loadPdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(pdfjsBuffer) }).promise;
      const numPages = doc.numPages;
      try { await doc.destroy(); } catch {}

      setPlansAvailable(true);
      setPlansFileName(file.name);
      setPlansNumPages(numPages);

      const proj = projectRef.current;
      if (proj) {
        await savePlans(proj.id, storageBuffer, file.name, numPages);
      }
    } catch (err) {
      console.error('[BLD] Plans upload error:', err);
      alert('Error loading plans PDF: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const handleCreateManualProject = useCallback(() => {
    const projectId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const proj: AppProject = {
      id: projectId,
      name: 'Manual Prep Sheet',
      fileName: '',
      segments: [],
      columnMapping: {} as Record<PrepField, number | null>,
      fallbackColumns: {},
      columnHeaders: [],
      savedAt: Date.now(),
      isManualProject: true,
    };
    setProject(proj);
    setMappingWarnings([]);
    setPendingFile(null);
    setPendingMapping(null);
    setObservations({});
    setMapData({});
    setJobNumber('');
    setJobName('');
    setDateFilter({ start: null, end: null });
    setSelectedSegments(new Set());
    setScreen('settings');
  }, []);

  const handleAddBlankSegment = useCallback(() => {
    const proj = projectRef.current;
    if (!proj) return;
    // Assign a unique repair number placeholder based on existing count.
    // Worker can change it in the editor — fieldOverride system handles that.
    let n = proj.segments.length + 1;
    const existing = new Set(proj.segments.map(s => s.repairNumber));
    let candidate = `NEW-${n}`;
    while (existing.has(candidate)) {
      n += 1;
      candidate = `NEW-${n}`;
    }
    const newSeg = createBlankSegment(candidate, proj.segments.length);
    const updated: AppProject = {
      ...proj,
      segments: [...proj.segments, newSeg],
      savedAt: Date.now(),
    };
    setProject(updated);
    // Open the editor for the new segment immediately.
    setSelectedSegmentIndex(updated.segments.length - 1);
    setObservations(prev => ({
      ...prev,
      [newSeg.repairNumber]: { ...DEFAULT_OBSERVATIONS },
    }));
    setScreen('editor');
  }, []);

  const handleSettingsComplete = useCallback(async (jn: string, jnm: string) => {
    const proj = projectRef.current;
    if (!proj) return;
    await saveProjectDefaults({ projectId: proj.id, jobNumber: jn, jobName: jnm, savedAt: Date.now() });
    setJobNumber(jn);
    setJobName(jnm);
    setScreen('segments');
  }, []);

  // Track the segment currently in the editor so we can evict its giant base64
  // image data when the user moves on. Without eviction, every segment edited
  // in a session leaves a multi-MB PNG sitting in React state forever — which
  // is what was crashing browser tabs on long sessions.
  const currentSegmentIdRef = useRef<string | null>(null);

  const handleSegmentSelect = useCallback(async (segmentIndex: number) => {
    const proj = projectRef.current;
    if (!proj) return;
    const segment = proj.segments[segmentIndex];
    if (!segment) return;

    // Evict the PREVIOUS segment's image data before loading the new one.
    // We keep annotations (small) so the editor knows what shapes existed,
    // but drop the giant imageDataUrl / rawImageDataUrl strings. They'll be
    // re-hydrated from IndexedDB if the user navigates back, or all at once
    // when entering BatchExport.
    const prevId = currentSegmentIdRef.current;
    if (prevId && prevId !== segment.repairNumber) {
      setMapData(state => {
        const existing = state[prevId];
        if (!existing) return state;
        if (!existing.imageDataUrl && !existing.rawImageDataUrl) return state;
        return {
          ...state,
          [prevId]: { ...existing, imageDataUrl: null, rawImageDataUrl: null },
        };
      });
    }
    currentSegmentIdRef.current = segment.repairNumber;

    const draft = await getDraft(proj.id, segment.repairNumber);
    const obs: SegmentObservations = draft
      ? draft.observations
      : { ...DEFAULT_OBSERVATIONS, readyToLine: segment.readyToLine ? true : null };

    const ms: MapState = draft?.mapImageDataUrl
      ? { imageDataUrl: draft.mapImageDataUrl, rawImageDataUrl: draft.mapRawImageDataUrl ?? draft.mapImageDataUrl, annotations: draft.mapAnnotations ?? [] }
      : { imageDataUrl: null, rawImageDataUrl: null, annotations: [] };

    setSelectedSegmentIndex(segmentIndex);
    setObservations(prev => ({ ...prev, [segment.repairNumber]: obs }));
    // Always reload map state from the freshly-fetched draft so an evicted
    // segment gets its image back when the user returns to it.
    setMapData(prev => ({ ...prev, [segment.repairNumber]: ms }));
    setScreen('editor');
  }, []);

  // On-demand fetcher for the plans PDF buffer. Plans live in IndexedDB
  // only — never in App state — so SegmentEditor calls this when the user
  // clicks "Crop from Plans" and drops the buffer reference when done.
  // Two slices: one for pdf.js inside PlanViewer (which may detach),
  // and one returned to the caller for any other consumer.
  const getPlanBuffer = useCallback(async (): Promise<ArrayBuffer | null> => {
    const proj = projectRef.current;
    if (!proj) return null;
    const plans = await getPlans(proj.id);
    if (!plans?.pdfData) return null;
    return plans.pdfData.slice(0);
  }, []);

  // Hydrate map images from IndexedDB for all selected segments before
  // entering the BatchExport screen. Segments that were edited earlier in
  // the session have had their images evicted from in-memory mapData (see
  // handleSegmentSelect) — without this hydrate, batch-exported PDFs would
  // be missing maps for those segments.
  const handleBatchExportEnter = useCallback(async () => {
    const proj = projectRef.current;
    if (!proj) {
      setScreen('batch');
      return;
    }
    const ids = Array.from(selectedSegments);
    const hydrations = await Promise.all(
      ids.map(id => getDraft(proj.id, id).then(d => ({ id, draft: d })))
    );
    setMapData(state => {
      const next = { ...state };
      for (const { id, draft } of hydrations) {
        if (!draft) continue;
        const existing = next[id] ?? { imageDataUrl: null, rawImageDataUrl: null, annotations: [] };
        next[id] = {
          imageDataUrl: draft.mapImageDataUrl ?? existing.imageDataUrl,
          rawImageDataUrl: draft.mapRawImageDataUrl ?? existing.rawImageDataUrl,
          annotations: draft.mapAnnotations ?? existing.annotations,
        };
      }
      return next;
    });
    setScreen('batch');
  }, [selectedSegments]);

  // Debounce timer per segmentId so rapid-fire keystrokes coalesce into one
  // IndexedDB write per ~400ms idle window. Without this, every character
  // typed fired a synchronous saveDraft including the giant base64 map
  // composite — the dominant cause of the "sticky" feel after a few edits.
  const saveDraftTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleObservationChange = useCallback((
    segmentId: string,
    obsOrUpdater: SegmentObservations | ((prev: SegmentObservations) => SegmentObservations),
  ) => {
    const proj = projectRef.current;
    if (!proj) return;

    // Resolve against the LATEST state via setState's functional form so
    // rapid-fire edits (a field edit followed by a toggle in the same tick)
    // compose correctly. Without this, two updates built from stale closures
    // would clobber each other — which is how previously-typed pipe size /
    // street name overrides were disappearing by the time of PDF export.
    setObservations(prev => {
      const prevForSegment = prev[segmentId] ?? { ...DEFAULT_OBSERVATIONS };
      const nextObs =
        typeof obsOrUpdater === 'function'
          ? (obsOrUpdater as (p: SegmentObservations) => SegmentObservations)(prevForSegment)
          : obsOrUpdater;
      return { ...prev, [segmentId]: nextObs };
    });

    // Debounced persist. The map composite is owned by handleMapChange
    // (which writes its own draft on annotation edits) — observations-only
    // edits don't need to ship the multi-MB base64 image with every keystroke.
    if (saveDraftTimers.current[segmentId]) {
      clearTimeout(saveDraftTimers.current[segmentId]);
    }
    saveDraftTimers.current[segmentId] = setTimeout(() => {
      const obs = observationsRef.current[segmentId];
      if (!obs) return;
      saveDraft({
        projectId: proj.id,
        segmentId,
        observations: obs,
        mapAnnotations: mapDataRef.current[segmentId]?.annotations,
        savedAt: Date.now(),
      });
      delete saveDraftTimers.current[segmentId];
    }, 400);
  }, []);

  const handleMapChange = useCallback(async (segmentId: string, compositeUrl: string | null, rawUrl: string | null, anns: AnnotationData[]) => {
    const proj = projectRef.current;
    if (!proj) return;
    const ms: MapState = { imageDataUrl: compositeUrl, rawImageDataUrl: rawUrl, annotations: anns };
    setMapData(prev => ({ ...prev, [segmentId]: ms }));
    const obs = observationsRef.current[segmentId] ?? DEFAULT_OBSERVATIONS;
    await saveDraft({
      projectId: proj.id,
      segmentId,
      observations: obs,
      mapImageDataUrl: compositeUrl ?? undefined,
      mapRawImageDataUrl: rawUrl ?? undefined,
      mapAnnotations: anns,
      savedAt: Date.now(),
    });
  }, []);

  const handleCopyPrevious = useCallback(() => {
    const proj = projectRef.current;
    if (!proj) return;
    const idx = selectedSegmentIndex;
    if (idx === 0) return;
    const prevSeg = proj.segments[idx - 1];
    const prevObs = observationsRef.current[prevSeg.repairNumber];
    if (!prevObs) return;
    const currSeg = proj.segments[idx];
    const currObs = observationsRef.current[currSeg.repairNumber] ?? { ...DEFAULT_OBSERVATIONS };
    const copied: SegmentObservations = { ...prevObs, readyToLine: currObs.readyToLine, notes: currObs.notes };
    handleObservationChange(currSeg.repairNumber, copied);
  }, [selectedSegmentIndex, handleObservationChange]);

  const handleRecentProjectLoad = useCallback(async (proj: AppProject) => {
    const defaults = await getProjectDefaults(proj.id);
    const allDrafts = await db.segmentDrafts.where('projectId').equals(proj.id).toArray();
    const obs: Record<string, SegmentObservations> = {};
    const maps: Record<string, MapState> = {};
    for (const draft of allDrafts) {
      obs[draft.segmentId] = draft.observations;
      if (draft.mapImageDataUrl) {
        maps[draft.segmentId] = {
          imageDataUrl: draft.mapImageDataUrl,
          rawImageDataUrl: draft.mapRawImageDataUrl ?? draft.mapImageDataUrl,
          annotations: draft.mapAnnotations ?? [],
        };
      }
    }
    // Load saved plans metadata — the actual buffer stays in IDB, fetched
    // on demand when the plan viewer opens.
    const plans = await getPlans(proj.id);
    if (plans) {
      setPlansAvailable(true);
      setPlansFileName(plans.fileName);
      setPlansNumPages(plans.numPages);
    } else {
      setPlansAvailable(false);
      setPlansFileName(null);
      setPlansNumPages(0);
    }
    setProject(proj);
    setObservations(obs);
    setMapData(maps);
    setMappingWarnings([]);
    setJobNumber(defaults?.jobNumber ?? '');
    setJobName(defaults?.jobName ?? '');
    setDateFilter({ start: null, end: null });
    setSelectedSegments(new Set());
    setScreen('segments');
  }, []);

  const currentSegment = project?.segments[selectedSegmentIndex];
  const currentSegmentId = currentSegment?.repairNumber ?? '';
  const currentObs = observations[currentSegmentId] ?? { ...DEFAULT_OBSERVATIONS };
  const currentMap = mapData[currentSegmentId] ?? { imageDataUrl: null, rawImageDataUrl: null, annotations: [] };

  // Block render until the mount-time IndexedDB wipe finishes — otherwise
  // components could query stale data in the ~50ms window before it's cleared.
  if (!ready) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }} />
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Top nav — navy brand bar */}
      <header style={{
        background: 'var(--nav-bg)',
        borderBottom: '1px solid var(--nav-border)',
        boxShadow: '0 2px 12px rgba(11, 23, 38, 0.25)',
        position: 'sticky', top: 0, zIndex: 50,
      }} className="px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div style={{ background: '#FFFFFF', borderRadius: 6, padding: '3px 10px' }}>
            <span style={{ color: 'var(--nav-bg)', fontWeight: 700, fontSize: 14, letterSpacing: '0.05em' }}>BLD</span>
          </div>
          <span className="font-semibold text-base" style={{ color: 'var(--nav-text)' }}>
            Prep Sheet Tool
          </span>
        </div>

        {project && (
          <div className="flex items-center gap-2 ml-4" style={{ color: 'var(--nav-text-muted)', fontSize: 14 }}>
            <span style={{ color: 'var(--nav-text-muted)', opacity: 0.5 }}>/</span>
            <span>{project.name}</span>
            {jobNumber && (
              <>
                <span style={{ color: 'var(--nav-text-muted)', opacity: 0.5 }}>|</span>
                <span>Job #{jobNumber}</span>
              </>
            )}
          </div>
        )}

        {/* Session-level OPERATOR input — required for PDF export */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{
            color: 'var(--nav-text-muted)',
            fontSize: 13, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Operator
          </label>
          <input
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Your name"
            style={{
              background: operator ? 'rgba(255,255,255,0.12)' : 'rgba(255,180,70,0.18)',
              border: `1px solid ${operator ? 'rgba(255,255,255,0.2)' : 'rgba(255,180,70,0.5)'}`,
              color: 'var(--nav-text)',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 14,
              width: 160,
              outline: 'none',
            }}
          />
        </div>

        <div className="flex gap-2">
          {screen !== 'home' && (
            <button
              onClick={() => setScreen('home')}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--nav-text)', borderRadius: 6, padding: '5px 14px',
                fontSize: 14, cursor: 'pointer',
              }}>
              Home
            </button>
          )}
          {(screen === 'editor' || screen === 'preview') && project && (
            <button
              onClick={() => setScreen('segments')}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--nav-text)', borderRadius: 6, padding: '5px 14px',
                fontSize: 14, cursor: 'pointer',
              }}>
              Segments
            </button>
          )}
          {screen === 'preview' && (
            <button
              onClick={() => setScreen('editor')}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--nav-text)', borderRadius: 6, padding: '5px 14px',
                fontSize: 14, cursor: 'pointer',
              }}>
              Editor
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="p-6">
        {screen === 'home' && (
          <HomeScreen
            recentProjects={recentProjects}
            onFileUpload={handleFileUpload}
            onLoadProject={handleRecentProjectLoad}
            onCreateManualProject={handleCreateManualProject}
          />
        )}
        {screen === 'sheetpicker' && pendingFile && (
          <SheetPicker
            sheets={pendingFile.sheets}
            onSelect={handleSheetSelect}
            onCancel={() => { setPendingFile(null); setScreen('home'); }}
          />
        )}
        {screen === 'mapping' && pendingMapping && (
          <ColumnMapper
            headers={pendingMapping.headers}
            confident={pendingMapping.confident}
            uncertain={pendingMapping.uncertain}
            onComplete={handleMappingComplete}
          />
        )}
        {screen === 'settings' && project && (
          <ProjectSettings
            project={project}
            initialJobNumber={jobNumber}
            initialJobName={jobName}
            plansFileName={plansFileName}
            mappingWarnings={mappingWarnings}
            onPlansUpload={handlePlansUpload}
            onRemapUpload={handleRemapUpload}
            onFixMapping={handleFixMapping}
            onComplete={handleSettingsComplete}
          />
        )}
        {screen === 'segments' && project && (
          <SegmentList
            project={project}
            jobNumber={jobNumber}
            jobName={jobName}
            observations={observations}
            mapData={mapData}
            dateFilter={dateFilter}
            selectedSegments={selectedSegments}
            onDateFilterChange={setDateFilter}
            onSegmentSelect={handleSegmentSelect}
            onSelectionChange={setSelectedSegments}
            onEditSettings={() => setScreen('settings')}
            onBatchExport={handleBatchExportEnter}
            onAddBlankSegment={handleAddBlankSegment}
          />
        )}
        {screen === 'editor' && project && currentSegment && (
          <SegmentEditor
            segment={currentSegment}
            segmentIndex={selectedSegmentIndex}
            totalSegments={project.segments.length}
            jobNumber={jobNumber}
            jobName={jobName}
            observations={currentObs}
            mapImageDataUrl={currentMap.imageDataUrl}
            mapRawImageDataUrl={currentMap.rawImageDataUrl}
            mapAnnotations={currentMap.annotations}
            canCopyPrevious={selectedSegmentIndex > 0}
            plansAvailable={plansAvailable}
            plansNumPages={plansNumPages}
            getPlanBuffer={getPlanBuffer}
            onObservationChange={(obs) => handleObservationChange(currentSegmentId, obs)}
            onMapChange={(compositeUrl, rawUrl, anns) => handleMapChange(currentSegmentId, compositeUrl, rawUrl, anns)}
            onCopyPrevious={handleCopyPrevious}
            onPreviewPdf={() => setScreen('preview')}
            onNavigate={(dir) => {
              const newIdx = selectedSegmentIndex + dir;
              if (newIdx >= 0 && newIdx < project!.segments.length) {
                handleSegmentSelect(newIdx);
              }
            }}
          />
        )}
        {screen === 'preview' && project && currentSegment && (
          <PdfPreview
            segment={currentSegment}
            observations={currentObs}
            jobNumber={jobNumber}
            jobName={jobName}
            operator={operator}
            mapImageDataUrl={currentMap.imageDataUrl ?? undefined}
            onBack={() => setScreen('editor')}
          />
        )}
        {screen === 'batch' && project && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <button
                onClick={() => setScreen('segments')}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', borderRadius: 6, padding: '7px 14px',
                  fontSize: 14, cursor: 'pointer',
                }}>
                &larr; Back to Segments
              </button>
            </div>
            <BatchExport
              segments={
                project.segments
                  .filter(seg => selectedSegments.has(seg.repairNumber))
                  .map(seg => ({
                    segment: seg,
                    observations: observations[seg.repairNumber] ?? { ...DEFAULT_OBSERVATIONS },
                    mapImageDataUrl: mapData[seg.repairNumber]?.imageDataUrl ?? undefined,
                  }))
              }
              jobNumber={jobNumber}
              jobName={jobName}
              operator={operator}
            />
          </div>
        )}
      </main>
    </div>
  );
}

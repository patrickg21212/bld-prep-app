import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { PrepField, Segment, SegmentObservations, AppProject, AnnotationData } from '../lib/types';
import { DEFAULT_OBSERVATIONS } from '../lib/types';
import { parseExcelFile, rowsToSegments, getWeekRanges, listSheets } from '../lib/excel';
import type { SheetInfo } from '../lib/excel';
import { autoMapColumns, fingerprintHeaders } from '../lib/fuzzy';
import { db, getSavedMapping, saveMapping, saveDraft, getDraft, getProjectDefaults, saveProjectDefaults, getRecentProjects, savePlans, getPlans } from '../lib/db';

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
  const [plansData, setPlansData] = useState<ArrayBuffer | null>(null);
  const [plansFileName, setPlansFileName] = useState<string | null>(null);
  const [plansNumPages, setPlansNumPages] = useState(0);

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

  useEffect(() => {
    getRecentProjects().then(setRecentProjects);
  }, []);

  // Process a specific sheet from a buffer
  const processSheet = useCallback(async (buffer: ArrayBuffer, fileName: string, sheetName: string) => {
    try {
      console.log('[BLD] processSheet:', sheetName);
      const { headers, rows } = parseExcelFile(buffer, sheetName);
      console.log('[BLD] Parsed:', headers.length, 'headers,', rows.length, 'rows');
      const fingerprint = fingerprintHeaders(headers);
      const savedMap = await getSavedMapping(fingerprint);

      if (savedMap) {
        console.log('[BLD] Found saved mapping, skipping to settings');
        const { fallbacks: fb } = autoMapColumns(headers);
        const segments = rowsToSegments(rows, savedMap.mapping as Record<PrepField, number | null>, fb);
        const projectId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const proj: AppProject = {
          id: projectId,
          name: fileName.replace(/\.(xlsx|xls|csv)$/i, ''),
          fileName,
          segments,
          columnMapping: savedMap.mapping as Record<PrepField, number | null>,
          fallbackColumns: fb,
          columnHeaders: headers,
          savedAt: Date.now(),
        };
        const defaults = await getProjectDefaults(projectId);
        setProject(proj);
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

  const handlePlansUpload = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      // Get page count using CDN-loaded pdf.js to avoid bundling issues
      const pdfjsLib = await import(/* @vite-ignore */ `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs`);
      const lib = pdfjsLib.default || pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`;
      const doc = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const numPages = doc.numPages;

      setPlansData(buffer);
      setPlansFileName(file.name);
      setPlansNumPages(numPages);

      const proj = projectRef.current;
      if (proj) {
        await savePlans(proj.id, buffer, file.name, numPages);
      }
    } catch (err) {
      console.error('[BLD] Plans upload error:', err);
      alert('Error loading plans PDF: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const handleSettingsComplete = useCallback(async (jn: string, jnm: string) => {
    const proj = projectRef.current;
    if (!proj) return;
    await saveProjectDefaults({ projectId: proj.id, jobNumber: jn, jobName: jnm, savedAt: Date.now() });
    setJobNumber(jn);
    setJobName(jnm);
    setScreen('segments');
  }, []);

  const handleSegmentSelect = useCallback(async (segmentIndex: number) => {
    const proj = projectRef.current;
    if (!proj) return;
    const segment = proj.segments[segmentIndex];
    if (!segment) return;

    const draft = await getDraft(proj.id, segment.repairNumber);
    const obs: SegmentObservations = draft
      ? draft.observations
      : { ...DEFAULT_OBSERVATIONS, readyToLine: segment.readyToLine ? true : null };

    const ms: MapState = draft?.mapImageDataUrl
      ? { imageDataUrl: draft.mapImageDataUrl, rawImageDataUrl: draft.mapRawImageDataUrl ?? draft.mapImageDataUrl, annotations: draft.mapAnnotations ?? [] }
      : { imageDataUrl: null, rawImageDataUrl: null, annotations: [] };

    setSelectedSegmentIndex(segmentIndex);
    setObservations(prev => ({ ...prev, [segment.repairNumber]: obs }));
    setMapData(prev => ({ ...prev, [segment.repairNumber]: prev[segment.repairNumber] ?? ms }));
    setScreen('editor');
  }, []);

  const handleObservationChange = useCallback(async (segmentId: string, obs: SegmentObservations) => {
    const proj = projectRef.current;
    if (!proj) return;
    setObservations(prev => ({ ...prev, [segmentId]: obs }));
    const map = mapDataRef.current[segmentId];
    await saveDraft({
      projectId: proj.id,
      segmentId,
      observations: obs,
      mapImageDataUrl: map?.imageDataUrl ?? undefined,
      mapAnnotations: map?.annotations ?? undefined,
      savedAt: Date.now(),
    });
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
    // Load saved plans
    const plans = await getPlans(proj.id);
    if (plans) {
      setPlansData(plans.pdfData);
      setPlansFileName(plans.fileName);
      setPlansNumPages(plans.numPages);
    } else {
      setPlansData(null);
      setPlansFileName(null);
      setPlansNumPages(0);
    }
    setProject(proj);
    setObservations(obs);
    setMapData(maps);
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

        <div className="ml-auto flex gap-2">
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
            onPlansUpload={handlePlansUpload}
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
            onBatchExport={() => setScreen('batch')}
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
            plansData={plansData}
            plansNumPages={plansNumPages}
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
            />
          </div>
        )}
      </main>
    </div>
  );
}

import React, { useCallback, useState, lazy, Suspense, memo } from 'react';
import type { Segment, SegmentObservations, SegmentFieldKey, WaterFlow, MhLocation, AnnotationData } from '../lib/types';
import MapAnnotation from './MapAnnotation';

const PlanViewer = lazy(() => import('./PlanViewer'));
const MapViewer = lazy(() => import('./MapViewer'));

interface Props {
  segment: Segment;
  segmentIndex: number;
  totalSegments: number;
  jobNumber: string;
  jobName: string;
  observations: SegmentObservations;
  mapImageDataUrl: string | null;
  mapRawImageDataUrl: string | null;
  mapAnnotations: AnnotationData[];
  canCopyPrevious: boolean;
  // plans are no longer held in App state — they live in IndexedDB and are
  // fetched on-demand only while the plan viewer is open. plansAvailable
  // indicates whether plans exist for this project; getPlanBuffer fetches.
  plansAvailable: boolean;
  plansNumPages: number;
  getPlanBuffer: () => Promise<ArrayBuffer | null>;
  onObservationChange: (
    obsOrUpdater: SegmentObservations | ((prev: SegmentObservations) => SegmentObservations),
  ) => void;
  onMapChange: (compositeUrl: string | null, rawUrl: string | null, annotations: AnnotationData[]) => void;
  onCopyPrevious: () => void;
  onPreviewPdf: () => void;
  onNavigate: (dir: 1 | -1) => void;
}

function SegmentEditorImpl({
  segment,
  segmentIndex,
  totalSegments,
  jobNumber,
  jobName,
  observations,
  mapImageDataUrl,
  mapRawImageDataUrl,
  mapAnnotations,
  canCopyPrevious,
  plansAvailable,
  plansNumPages,
  getPlanBuffer,
  onObservationChange,
  onMapChange,
  onCopyPrevious,
  onPreviewPdf,
  onNavigate,
}: Props) {
  const [showPlanViewer, setShowPlanViewer] = useState(false);
  // Local plan buffer — held only while the viewer modal is open. Cleared
  // on close so the multi-MB ArrayBuffer doesn't sit in memory between
  // segment edits. Fetched from IndexedDB via getPlanBuffer().
  const [planBuffer, setPlanBuffer] = useState<ArrayBuffer | null>(null);

  const handleOpenPlanViewer = useCallback(async () => {
    if (!plansAvailable) return;
    const buf = await getPlanBuffer();
    if (!buf) return;
    setPlanBuffer(buf);
    setShowPlanViewer(true);
  }, [plansAvailable, getPlanBuffer]);

  const handleClosePlanViewer = useCallback(() => {
    setShowPlanViewer(false);
    setPlanBuffer(null);
  }, []);
  const [showMapViewer, setShowMapViewer] = useState(false);

  // Pass updater functions to onObservationChange so rapid-fire edits compose
  // against the latest state rather than a stale closure snapshot. Previously
  // two updates fired in the same tick (e.g. typing pipe size then toggling a
  // Yes/No) both built their next state from the same stale `observations`
  // prop, so the second update silently dropped the first — which made
  // overrides disappear by the time the PDF was generated.
  const set = useCallback(<K extends keyof SegmentObservations>(key: K, val: SegmentObservations[K]) => {
    onObservationChange(prev => ({ ...prev, [key]: val }));
  }, [onObservationChange]);

  // Per-field overrides — segment fields pulled from the spreadsheet can be
  // edited on the prep sheet. Override is stored in observations.fieldOverrides.
  const fieldValue = (key: SegmentFieldKey, fallback: string): string => {
    const override = observations.fieldOverrides?.[key];
    return override !== undefined ? override : fallback;
  };
  const setFieldOverride = useCallback((key: SegmentFieldKey, val: string, fallback: string) => {
    onObservationChange(prev => {
      const existing = prev.fieldOverrides ?? {};
      const next = { ...existing };
      // If user clears override back to the original value, drop the override
      // entirely so the prep sheet re-follows the spreadsheet on future edits.
      if (val === fallback) {
        delete next[key];
      } else {
        next[key] = val;
      }
      return { ...prev, fieldOverrides: next };
    });
  }, [onObservationChange]);

  // Parse sheet number — returns [preferredPage, ...otherPages]
  // "9/10" → [10, 9] (second page = aerial/satellite, preferred)
  // "9"    → [9]
  const getSheetPages = (): number[] => {
    const raw = segment.sheetNumber?.trim();
    if (!raw) return [1];
    const matches = raw.match(/\d+/g);
    if (!matches) return [1];
    const pages = matches.map(n => parseInt(n, 10)).filter(n => n > 0 && n < 9999);
    if (pages.length === 0) return [1];
    if (pages.length >= 2) {
      // Prefer the second page (aerial/satellite view in paired-page engineering PDFs)
      return [pages[1], pages[0]];
    }
    return pages;
  };

  const handlePlanCrop = useCallback((croppedDataUrl: string, _relX: number, _relY: number) => {
    // Don't auto-place an ellipse — pipe segments are straight lines at
    // arbitrary angles, and any guessed placement ended up wrong 100% of the
    // time (wrong center, wrong orientation, wrong length/thickness). Hand
    // the user the crop with no annotations and switch MapAnnotation into
    // Draw-Ellipse mode so they can drag from one end of the pipe to the
    // other — that yields a correctly-aligned ellipse in one gesture.
    onMapChange(null, croppedDataUrl, []);
    // Modal close is handled by handleClosePlanViewer in the onCrop wrapper —
    // it also drops the in-memory plan buffer.
  }, [onMapChange]);

  const handleMapCrop = useCallback((croppedDataUrl: string) => {
    // Same downstream path as plan crops — raw image, no annotations, the
    // worker draws the pipe ellipse on top.
    onMapChange(null, croppedDataUrl, []);
    setShowMapViewer(false);
  }, [onMapChange]);

  if (!segment) return null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Repair #{segment.repairNumber}
          </h2>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 2 }}>
            {segment.streetName} &middot; Segment {segmentIndex + 1} of {totalSegments}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {canCopyPrevious && (
            <button
              onClick={onCopyPrevious}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                color: 'var(--text-secondary)', borderRadius: 6, padding: '7px 14px',
                fontSize: 14, cursor: 'pointer',
              }}>
              Copy Previous
            </button>
          )}
          <button
            onClick={onPreviewPdf}
            style={{
              background: 'var(--accent)', border: '1px solid var(--accent)',
              color: 'white', borderRadius: 6, padding: '7px 14px',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
            Preview PDF
          </button>
          <button
            disabled={segmentIndex === 0}
            onClick={() => onNavigate(-1)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: segmentIndex === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
              borderRadius: 6, padding: '7px 12px', fontSize: 14,
              cursor: segmentIndex === 0 ? 'not-allowed' : 'pointer',
            }}>
            &larr; Prev
          </button>
          <button
            disabled={segmentIndex === totalSegments - 1}
            onClick={() => onNavigate(1)}
            style={{
              background: segmentIndex === totalSegments - 1 ? 'var(--bg-card)' : 'var(--accent)',
              border: '1px solid var(--border)',
              color: 'white',
              borderRadius: 6, padding: '7px 12px', fontSize: 14,
              cursor: segmentIndex === totalSegments - 1 ? 'not-allowed' : 'pointer',
              opacity: segmentIndex === totalSegments - 1 ? 0.5 : 1,
            }}>
            Next &rarr;
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left column: Segment Fields — all editable (spreadsheet or blank) */}
        <div>
          <SectionHeader>Segment Fields</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <EditableField label="DATE" value={fieldValue('dateStr', segment.dateStr)} sheetValue={segment.dateStr} onChange={(v) => setFieldOverride('dateStr', v, segment.dateStr)} />
            <EditableField label="REPAIR #" value={fieldValue('repairNumber', segment.repairNumber)} sheetValue={segment.repairNumber} onChange={(v) => setFieldOverride('repairNumber', v, segment.repairNumber)} />
            <EditableField label="PIPE SIZE" value={fieldValue('pipeSize', segment.pipeSize)} sheetValue={segment.pipeSize} onChange={(v) => setFieldOverride('pipeSize', v, segment.pipeSize)} />
            <EditableField label="PIPE LENGTH" value={fieldValue('pipeLength', segment.pipeLength)} sheetValue={segment.pipeLength} onChange={(v) => setFieldOverride('pipeLength', v, segment.pipeLength)} />
            <EditableField label="PIPE MATERIAL" value={fieldValue('pipeMaterial', segment.pipeMaterial)} sheetValue={segment.pipeMaterial} onChange={(v) => setFieldOverride('pipeMaterial', v, segment.pipeMaterial)} />
            <EditableField label="STREET NAME" value={fieldValue('streetName', segment.streetName)} sheetValue={segment.streetName} onChange={(v) => setFieldOverride('streetName', v, segment.streetName)} />
            <EditableField label="USMH DEPTH" value={fieldValue('usDepth', segment.usDepth)} sheetValue={segment.usDepth} onChange={(v) => setFieldOverride('usDepth', v, segment.usDepth)} />
            <EditableField label="DSMH DEPTH" value={fieldValue('dsDepth', segment.dsDepth)} sheetValue={segment.dsDepth} onChange={(v) => setFieldOverride('dsDepth', v, segment.dsDepth)} />
            <EditableField label="USMH" value={fieldValue('mhFrom', segment.mhFrom)} sheetValue={segment.mhFrom} onChange={(v) => setFieldOverride('mhFrom', v, segment.mhFrom)} />
            <EditableField label="DSMH" value={fieldValue('mhTo', segment.mhTo)} sheetValue={segment.mhTo} onChange={(v) => setFieldOverride('mhTo', v, segment.mhTo)} />
            <EditableField label="SHEET #" value={fieldValue('sheetNumber', segment.sheetNumber)} sheetValue={segment.sheetNumber} onChange={(v) => setFieldOverride('sheetNumber', v, segment.sheetNumber)} />
            <EditableField label="COMMENTS (EXCEL)" value={fieldValue('comments', segment.comments)} sheetValue={segment.comments} onChange={(v) => setFieldOverride('comments', v, segment.comments)} multiline />
          </div>

          <div className="mt-4">
            <SectionHeader>Job Defaults</SectionHeader>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ReadOnlyField label="JOB #" value={jobNumber || '—'} />
              <ReadOnlyField label="JOB NAME" value={jobName || '—'} />
            </div>
          </div>
        </div>

        {/* Right column: Tech observations */}
        <div>
          <SectionHeader>Field Observations</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div>
              <FieldLabel>WATER FLOW</FieldLabel>
              <ThreeToggle
                options={['LIGHT', 'MEDIUM', 'HIGH'] as WaterFlow[]}
                value={observations.waterFlow}
                onChange={(v) => set('waterFlow', v as WaterFlow)}
              />
            </div>

            <div>
              <FieldLabel>OVERHEAD LINES OR TREES</FieldLabel>
              <YesNoToggle
                value={observations.overheadLines}
                onChange={(v) => set('overheadLines', v)}
              />
            </div>

            <div>
              <FieldLabel>INFILTRATION</FieldLabel>
              <YesNoToggle
                value={observations.infiltration}
                onChange={(v) => set('infiltration', v)}
              />
            </div>

            <div>
              <FieldLabel>NEEDS POINT REPAIR</FieldLabel>
              <YesNoToggle
                value={observations.needsPointRepair}
                onChange={(v) => set('needsPointRepair', v)}
              />
            </div>

            <div>
              <FieldLabel>READY TO LINE</FieldLabel>
              <YesNoToggle
                value={observations.readyToLine ?? (segment.readyToLine ? true : null)}
                onChange={(v) => set('readyToLine', v)}
              />
            </div>

            <div>
              <FieldLabel>M/H LOCATIONS</FieldLabel>
              <TwoToggle
                options={['STREET', 'EASEMENT'] as MhLocation[]}
                value={observations.mhLocation}
                onChange={(v) => set('mhLocation', v as MhLocation)}
              />
            </div>

            <TextInput
              label="INCOMING LINE SIZE"
              value={observations.incomingLinesSize}
              placeholder='e.g. 6", 8"'
              onChange={(v) => set('incomingLinesSize', v)}
            />

            <TextInput
              label="ADDRESS OF USMH"
              value={observations.addressUSMH}
              placeholder="Street address"
              onChange={(v) => set('addressUSMH', v)}
            />

            <TextInput
              label="ADDRESS OF DSMH"
              value={observations.addressDSMH}
              placeholder="Street address"
              onChange={(v) => set('addressDSMH', v)}
            />

            <div>
              <FieldLabel>BLOWN TOILETS</FieldLabel>
              <YesNoToggle
                value={observations.blowToilets}
                onChange={(v) => set('blowToilets', v)}
              />
              {observations.blowToilets === true && (
                <textarea
                  placeholder="List addresses of blown toilets..."
                  value={observations.toiletAddresses}
                  onChange={e => set('toiletAddresses', e.target.value)}
                  rows={3}
                  style={{
                    width: '100%', marginTop: 8,
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px',
                    fontSize: 14, resize: 'vertical', outline: 'none',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                />
              )}
            </div>

            <div>
              <FieldLabel>NOTES</FieldLabel>
              <textarea
                placeholder="Additional notes..."
                value={observations.notes}
                onChange={e => set('notes', e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px',
                  fontSize: 14, resize: 'vertical', outline: 'none',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>
          </div>

          {/* Auto-save indicator */}
          <div style={{
            marginTop: 16, color: 'var(--text-muted)', fontSize: 14,
            textAlign: 'right',
          }}>
            Auto-saved to local storage
          </div>
        </div>
      </div>

      {/* Map Annotation Section — full width below the two columns */}
      <div className="mt-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          <SectionHeader>Schematic Drawing / Map</SectionHeader>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {plansAvailable && (
              <button
                onClick={handleOpenPlanViewer}
                style={{
                  background: segment.sheetNumber ? 'var(--accent-subtle)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${segment.sheetNumber ? 'var(--accent)' : 'rgba(255,255,255,0.2)'}`,
                  color: segment.sheetNumber ? 'var(--accent)' : 'var(--text-muted)',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                title={segment.sheetNumber ? `Opens to page ${getSheetPages()[0]} (Sheet ${segment.sheetNumber})` : 'No sheet number mapped — will open to page 1. Type the page number manually in the viewer.'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                Crop from Plans
                {segment.sheetNumber
                  ? <span style={{ opacity: 0.7, fontSize: 13 }}>(Sheet {segment.sheetNumber} → pg {getSheetPages()[0]})</span>
                  : <span style={{ opacity: 0.6, fontSize: 12 }}>(no sheet # — type page manually)</span>
                }
              </button>
            )}
            <button
              onClick={() => setShowMapViewer(true)}
              style={{
                background: 'var(--accent-subtle)',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              title="No plans needed — punch in an address, frame the area on satellite imagery, and capture it as the map."
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
              Use Map
            </button>
          </div>
        </div>
        <MapAnnotation
          initialImage={mapRawImageDataUrl ?? undefined}
          initialAnnotations={mapAnnotations}
          onChange={(compositeUrl, rawUrl, anns) => onMapChange(compositeUrl, rawUrl, anns)}
        />
      </div>

      {/* PlanViewer modal — buffer is loaded on-demand, dropped on close */}
      {showPlanViewer && planBuffer && (
        <Suspense fallback={
          <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 16,
          }}>
            Loading plans viewer...
          </div>
        }>
          {(() => {
            const pages = getSheetPages();
            return (
              <PlanViewer
                pdfData={planBuffer}
                initialPage={pages[0]}
                sheetPages={pages.length > 1 ? pages : undefined}
                totalPages={plansNumPages}
                onCrop={(url, x, y) => { handlePlanCrop(url, x, y); handleClosePlanViewer(); }}
                onClose={handleClosePlanViewer}
              />
            );
          })()}
        </Suspense>
      )}

      {/* MapViewer modal — address search + aerial crop, no API keys */}
      {showMapViewer && (
        <Suspense fallback={
          <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 16,
          }}>
            Loading map viewer...
          </div>
        }>
          <MapViewer
            initialAddress={observations.addressUSMH || segment.streetName || ''}
            onCrop={handleMapCrop}
            onClose={() => setShowMapViewer(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

// React.memo blocks re-renders when props haven't changed by identity.
// Combined with App.tsx's debounced saveDraft and stable callback refs,
// this stops every keystroke from cascading through MapAnnotation's Konva
// tree on segments not currently being edited.
const SegmentEditor = memo(SegmentEditorImpl);
export default SegmentEditor;

// --- Sub-components ---

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: 'var(--text-muted)', fontSize: 14, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 10, marginTop: 4,
      borderBottom: '1px solid var(--border)', paddingBottom: 6,
    }}>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '8px 12px',
      display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: 10,
    }}>
      <span style={{
        color: 'var(--text-muted)', fontSize: 14, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        minWidth: 100, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{ color: value ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 14 }}>
        {value || '—'}
      </span>
    </div>
  );
}

function EditableField({
  label, value, sheetValue, onChange, multiline,
}: { label: string; value: string; sheetValue: string; onChange: (v: string) => void; multiline?: boolean }) {
  const isOverridden = value !== sheetValue;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isOverridden ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 6, padding: '8px 12px',
      display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: 10,
    }}>
      <span style={{
        color: 'var(--text-muted)', fontSize: 14, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        minWidth: 100, flexShrink: 0,
        paddingTop: multiline ? 4 : 0,
      }}>
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={sheetValue ? undefined : '—'}
          rows={2}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none',
            color: value ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: 14, padding: 0, outline: 'none', resize: 'vertical',
            fontWeight: isOverridden ? 600 : 400,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={sheetValue ? undefined : '—'}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none',
            color: value ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: 14, padding: 0, outline: 'none',
            fontWeight: isOverridden ? 600 : 400,
          }}
        />
      )}
      {isOverridden && (
        <span
          title={`Sheet value: ${sheetValue || '(empty)'} — click to revert`}
          onClick={() => onChange(sheetValue)}
          style={{
            color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            padding: '2px 6px', borderRadius: 4, background: 'var(--accent-subtle)',
            flexShrink: 0,
          }}
        >
          EDITED
        </span>
      )}
    </div>
  );
}

function ThreeToggle<T extends string>({ options, value, onChange }: {
  options: T[];
  value: T | '';
  onChange: (v: T | '') => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(value === opt ? '' : opt)}
          style={{
            flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
            background: value === opt ? 'var(--accent)' : 'var(--bg-card)',
            color: value === opt ? 'white' : 'var(--text-secondary)',
            border: `1px solid ${value === opt ? 'var(--accent)' : 'var(--border)'}`,
          }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function TwoToggle<T extends string>({ options, value, onChange }: {
  options: T[];
  value: T | '';
  onChange: (v: T | '') => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(value === opt ? '' : opt)}
          style={{
            flex: 1, padding: '8px 4px', borderRadius: 6, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
            background: value === opt ? 'var(--accent)' : 'var(--bg-card)',
            color: value === opt ? 'white' : 'var(--text-secondary)',
            border: `1px solid ${value === opt ? 'var(--accent)' : 'var(--border)'}`,
          }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function YesNoToggle({ value, onChange }: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        onClick={() => onChange(value === true ? null : true)}
        style={{
          flex: 1, padding: '8px', borderRadius: 6, fontSize: 14, fontWeight: 600,
          cursor: 'pointer', transition: 'all 0.15s',
          background: value === true ? 'var(--success)' : 'var(--bg-card)',
          color: value === true ? 'white' : 'var(--text-secondary)',
          border: `1px solid ${value === true ? 'var(--success)' : 'var(--border)'}`,
        }}>
        YES
      </button>
      <button
        onClick={() => onChange(value === false ? null : false)}
        style={{
          flex: 1, padding: '8px', borderRadius: 6, fontSize: 14, fontWeight: 600,
          cursor: 'pointer', transition: 'all 0.15s',
          background: value === false ? 'var(--danger)' : 'var(--bg-card)',
          color: value === false ? 'white' : 'var(--text-secondary)',
          border: `1px solid ${value === false ? 'var(--danger)' : 'var(--border)'}`,
        }}>
        NO
      </button>
    </div>
  );
}

function TextInput({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--bg-secondary)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px',
          fontSize: 14, outline: 'none',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />
    </div>
  );
}

import React, { useCallback } from 'react';
import type { Segment, SegmentObservations, TrafficLevel, WaterFlow, MhLocation, AnnotationData } from '../lib/types';
import MapAnnotation from './MapAnnotation';

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
  onObservationChange: (obs: SegmentObservations) => void;
  onMapChange: (compositeUrl: string | null, rawUrl: string | null, annotations: AnnotationData[]) => void;
  onCopyPrevious: () => void;
  onPreviewPdf: () => void;
  onNavigate: (dir: 1 | -1) => void;
}

export default function SegmentEditor({
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
  onObservationChange,
  onMapChange,
  onCopyPrevious,
  onPreviewPdf,
  onNavigate,
}: Props) {
  const set = useCallback(<K extends keyof SegmentObservations>(key: K, val: SegmentObservations[K]) => {
    onObservationChange({ ...observations, [key]: val });
  }, [observations, onObservationChange]);

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
        {/* Left column: Auto-populated fields */}
        <div>
          <SectionHeader>Auto-Populated from Excel</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ReadOnlyField label="DATE" value={segment.dateStr} />
            <ReadOnlyField label="REPAIR #" value={segment.repairNumber} />
            <ReadOnlyField label="PIPE SIZE" value={segment.pipeSize} />
            <ReadOnlyField label="PIPE LENGTH" value={segment.pipeLength} />
            <ReadOnlyField label="STREET NAME" value={segment.streetName} />
            <ReadOnlyField label="U.S. DEPTH" value={segment.usDepth} />
            <ReadOnlyField label="D.S. DEPTH" value={segment.dsDepth} />
            <ReadOnlyField label="M/H # FROM" value={segment.mhFrom} />
            <ReadOnlyField label="M/H # TO" value={segment.mhTo} />
            {segment.comments && (
              <ReadOnlyField label="COMMENTS (EXCEL)" value={segment.comments} multiline />
            )}
          </div>

          <div className="mt-4">
            <SectionHeader>Job Defaults</SectionHeader>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ReadOnlyField label="JOB #" value={jobNumber || '—'} />
              <ReadOnlyField label="JOB NAME" value={jobName || '—'} />
              <ReadOnlyField
                label="TIME"
                value={new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              />
            </div>
          </div>
        </div>

        {/* Right column: Tech observations */}
        <div>
          <SectionHeader>Field Observations</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div>
              <FieldLabel>TRAFFIC</FieldLabel>
              <ThreeToggle
                options={['LIGHT', 'MEDIUM', 'HIGH'] as TrafficLevel[]}
                value={observations.traffic}
                onChange={(v) => set('traffic', v as TrafficLevel)}
              />
            </div>

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
              label="HYDRANT LOCATION"
              value={observations.hydrantLocation}
              placeholder="e.g. NW corner of intersection"
              onChange={(v) => set('hydrantLocation', v)}
            />

            <TextInput
              label="INCOMING LINES SIZE"
              value={observations.incomingLinesSize}
              placeholder='e.g. 6", 8"'
              onChange={(v) => set('incomingLinesSize', v)}
            />

            <TextInput
              label="ADDRESS OF U.S.M.H"
              value={observations.addressUSMH}
              placeholder="Street address"
              onChange={(v) => set('addressUSMH', v)}
            />

            <TextInput
              label="ADDRESS OF D.S.M.H"
              value={observations.addressDSMH}
              placeholder="Street address"
              onChange={(v) => set('addressDSMH', v)}
            />

            <div>
              <FieldLabel>DID WE BLOW TOILETS</FieldLabel>
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
        <SectionHeader>Schematic Drawing / Map</SectionHeader>
        <MapAnnotation
          initialImage={mapRawImageDataUrl ?? undefined}
          initialAnnotations={mapAnnotations}
          onChange={(compositeUrl, rawUrl, anns) => onMapChange(compositeUrl, rawUrl, anns)}
        />
      </div>
    </div>
  );
}

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

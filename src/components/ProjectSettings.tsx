import React, { useState, useRef, useCallback } from 'react';
import type { AppProject, PrepField } from '../lib/types';
import { PREP_FIELD_LABELS } from '../lib/types';
import type { MappingWarning } from '../lib/fuzzy';
import { columnIndexToLetter } from '../lib/excel';

interface Props {
  project: AppProject;
  initialJobNumber: string;
  initialJobName: string;
  plansFileName: string | null;
  mappingWarnings: MappingWarning[];
  onPlansUpload: (file: File) => void;
  onRemapUpload: (file: File) => void;
  onFixMapping: (field: PrepField, columnIndex: number) => void;
  onComplete: (jobNumber: string, jobName: string) => void;
}

export default function ProjectSettings({ project, initialJobNumber, initialJobName, plansFileName, mappingWarnings, onPlansUpload, onRemapUpload, onFixMapping, onComplete }: Props) {
  const [jobNumber, setJobNumber] = useState(initialJobNumber);
  const [jobName, setJobName] = useState(initialJobName || project.name);
  const plansInputRef = useRef<HTMLInputElement>(null);
  const remapInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showRemap, setShowRemap] = useState(false);

  const handlePlansDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      onPlansUpload(file);
    }
  }, [onPlansUpload]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete(jobNumber.trim(), jobName.trim());
  };

  return (
    <div className="max-w-lg mx-auto pt-4">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Project Settings
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Set job-level defaults. These will auto-fill on every prep sheet for this project.
        </p>
      </div>

      {/* File summary */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '14px 16px', marginBottom: 24,
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>LOADED FILE</div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{project.fileName}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
          {project.segments.length} segments detected
        </div>
      </div>

      {/* Mapping health warnings — auto-detected missing fields */}
      {mappingWarnings.length > 0 && (
        <div style={{
          background: 'rgba(227,171,59,0.08)', border: '1px solid rgba(227,171,59,0.35)',
          borderRadius: 8, padding: '14px 16px', marginBottom: 24,
        }}>
          <div style={{ color: '#E3AB3B', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            Column Detection Issue
          </div>
          {mappingWarnings.map(w => (
            <div key={w.field} style={{ marginBottom: mappingWarnings.length > 1 ? 16 : 0 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 8 }}>
                <strong>{PREP_FIELD_LABELS[w.field]}</strong> was not detected in your spreadsheet.
              </div>

              {w.suggestion && (
                <div style={{
                  background: 'rgba(47,129,247,0.06)', border: '1px solid rgba(47,129,247,0.2)',
                  borderRadius: 6, padding: '10px 12px', marginBottom: 10,
                }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 6 }}>
                    Possible match: <strong style={{ color: 'var(--text-primary)' }}>
                      {w.suggestion.header}
                    </strong>
                    {' '}(values: {w.suggestion.sampleValues.slice(0, 4).join(', ')})
                  </div>
                  <button
                    type="button"
                    onClick={() => onFixMapping(w.field, w.suggestion!.columnIndex)}
                    style={{
                      background: 'var(--accent)', color: 'white', border: 'none',
                      borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Use this column
                  </button>
                </div>
              )}

              <select
                value=""
                onChange={e => {
                  if (e.target.value !== '') onFixMapping(w.field, Number(e.target.value));
                }}
                style={{
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  padding: '7px 10px', fontSize: 13, width: '100%', cursor: 'pointer',
                }}
              >
                <option value="">{w.suggestion ? 'Or pick a different column...' : 'Pick the column with this data...'}</option>
                {project.columnHeaders.map((h, i) => (
                  h.trim() ? <option key={i} value={i}>Col {columnIndexToLetter(i)}: {h}</option> : null
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Plans PDF upload with drag-and-drop */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handlePlansDrop}
        style={{
          background: dragOver ? 'rgba(47,129,247,0.06)' : 'var(--bg-card)',
          border: `1px ${plansFileName ? 'solid' : 'dashed'} ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8, padding: '14px 16px', marginBottom: 24,
          transition: 'all 0.15s',
        }}
      >
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
          PROJECT PLANS / MAP (Optional)
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 10 }}>
          Upload the project plans PDF to enable click-to-crop map images for each segment.
        </p>
        {plansFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              background: 'rgba(63,185,80,0.1)', color: 'var(--success)',
              borderRadius: 4, padding: '4px 10px', fontSize: 14, fontWeight: 600,
            }}>
              Loaded
            </span>
            <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{plansFileName}</span>
            <button
              type="button"
              onClick={() => plansInputRef.current?.click()}
              style={{
                background: 'none', border: 'none', color: 'var(--accent)',
                fontSize: 14, cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Replace
            </button>
          </div>
        ) : (
          <div
            onClick={() => plansInputRef.current?.click()}
            style={{
              background: dragOver ? 'rgba(47,129,247,0.1)' : 'var(--accent-subtle)',
              border: `1px dashed ${dragOver ? 'var(--accent)' : 'rgba(47,129,247,0.3)'}`,
              color: 'var(--accent)', borderRadius: 6, padding: '24px 20px',
              fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%',
              textAlign: 'center', transition: 'all 0.15s',
            }}
          >
            {dragOver ? 'Drop PDF here' : (
              <>
                <div style={{ marginBottom: 4 }}>Drag & drop plans PDF here</div>
                <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.7 }}>or click to browse</div>
              </>
            )}
          </div>
        )}
        <input
          ref={plansInputRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onPlansUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField
            label="JOB #"
            placeholder="e.g. 2024-NAS-001"
            value={jobNumber}
            onChange={setJobNumber}
            hint="Contract or work order number — appears on every prep sheet"
          />
          <FormField
            label="JOB NAME"
            placeholder="e.g. Nashville Annual Rehab — Phase 3"
            value={jobName}
            onChange={setJobName}
            hint="Project name — appears on every prep sheet"
          />
        </div>

        <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
          <button
            type="submit"
            style={{
              background: 'var(--accent)', color: 'white', border: 'none',
              borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600,
              cursor: 'pointer', flex: 1,
            }}>
            Continue to Segments →
          </button>
        </div>
      </form>

      {/* Re-map columns — advanced option */}
      <div style={{ marginTop: 32, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <button
          type="button"
          onClick={() => setShowRemap(v => !v)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14,
            cursor: 'pointer', padding: 0, textDecoration: 'underline',
          }}
        >
          {showRemap ? '▲ Hide' : '▼ Column mapping issue?'} Re-map columns
        </button>

        {showRemap && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 10 }}>
              If a field like SHEET # is not being detected, re-upload your Excel here.
              This bypasses the saved mapping and opens the column mapper so you can manually assign columns.
            </p>
            <div
              onClick={() => remapInputRef.current?.click()}
              style={{
                background: 'var(--bg-card)',
                border: '1px dashed var(--border)',
                borderRadius: 6, padding: '16px 20px',
                fontSize: 14, cursor: 'pointer', textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              Drop Excel file here or click to browse
            </div>
            <input
              ref={remapInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onRemapUpload(file);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface FormFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}

function FormField({ label, placeholder, value, onChange, hint }: FormFieldProps) {
  return (
    <div>
      <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 14,
        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--bg-card)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
          fontSize: 15, outline: 'none', transition: 'border-color 0.15s',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />
      {hint && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

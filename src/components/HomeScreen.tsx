import React, { useCallback, useRef, useState } from 'react';
import type { AppProject } from '../lib/types';

interface Props {
  recentProjects: AppProject[];
  onFileUpload: (file: File) => void;
  onLoadProject: (project: AppProject) => void;
}

export default function HomeScreen({ recentProjects, onFileUpload, onLoadProject }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError('Please upload an Excel file (.xlsx, .xls) or CSV.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onFileUpload(file);
    } catch (e: any) {
      setError(e.message ?? 'Failed to parse spreadsheet.');
    } finally {
      setLoading(false);
    }
  }, [onFileUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
      {/* Two-column layout: left = upload, right = workflow info */}
      <div style={{ display: 'grid', gridTemplateColumns: recentProjects.length > 0 ? '1fr 340px' : '1fr', gap: 28, alignItems: 'start' }}>
        {/* Main column */}
        <div>
          {/* Welcome card */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-md)',
            padding: '36px 32px',
            marginBottom: 24,
          }}>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                CIPP Liner Prep Sheet Generator
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
                Upload your inspection spreadsheet to auto-populate prep sheets, annotate schematic drawings, and export print-ready PDFs.
              </p>
            </div>

            {/* Upload zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
                background: dragging ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                borderRadius: 10,
                padding: '40px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {loading ? (
                <div>
                  <Spinner />
                  <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 14 }}>Parsing spreadsheet...</p>
                </div>
              ) : (
                <>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10, opacity: 0.6 }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, fontSize: 15 }}>
                    Drop your Excel file here
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    or click to browse — .xlsx, .xls, .csv supported
                  </p>
                </>
              )}
            </div>

            {error && (
              <div style={{
                background: 'var(--danger-subtle)', border: '1px solid var(--danger)',
                color: 'var(--danger)', borderRadius: 8, padding: '10px 14px', marginTop: 16, fontSize: 14,
              }}>
                {error}
              </div>
            )}
          </div>

          {/* Workflow steps */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-sm)',
            padding: '24px 28px',
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
              How It Works
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { step: '1', title: 'Upload Spreadsheet', desc: 'Drop your Excel inspection file and select the Mainline tracking sheet.' },
                { step: '2', title: 'Map Columns', desc: 'Auto-detects fields like Repair #, Pipe Size, MH numbers. Adjust if needed.' },
                { step: '3', title: 'Edit Segments', desc: 'Fill in field observations, traffic, water flow, and annotate the schematic map.' },
                { step: '4', title: 'Export PDFs', desc: 'Generate print-ready prep sheets that match the BLD template exactly.' },
              ].map(item => (
                <div key={item.step} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--accent)', color: '#FFFFFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, flexShrink: 0,
                  }}>
                    {item.step}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, marginBottom: 2 }}>
                      {item.title}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Recent projects */}
        {recentProjects.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-sm)',
            padding: '20px',
          }}>
            <h2 style={{
              fontSize: 14, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 14, paddingBottom: 10,
              borderBottom: '1px solid var(--border)',
            }}>
              Recent Projects
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentProjects.map(p => (
                <button
                  key={p.id}
                  onClick={() => onLoadProject(p)}
                  style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
                    borderRadius: 8, padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                    display: 'block', width: '100%',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-light)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, marginBottom: 3 }}>
                    {p.name}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                      {p.segments.length} segments
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                      {new Date(p.savedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 28, height: 28, border: '3px solid var(--border)',
      borderTopColor: 'var(--accent)', borderRadius: '50%',
      animation: 'spin 0.8s linear infinite', margin: '0 auto',
    }} />
  );
}

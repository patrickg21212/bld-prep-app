import React, { useState, useCallback, useRef } from 'react';
import type { Segment, SegmentObservations } from '../lib/types';
import type { PdfInput } from '../lib/pdf';
import { generateBatchPdf } from '../lib/pdf';

interface SegmentWithObservations {
  segment: Segment;
  observations: SegmentObservations;
  mapImageDataUrl?: string;
}

interface Props {
  segments: SegmentWithObservations[];
  jobNumber: string;
  jobName: string;
  operator: string;
}

type ExportState =
  | { status: 'idle' }
  | { status: 'generating'; current: number; total: number; mode: 'combined' | 'zip' }
  | { status: 'done'; mode: 'combined' | 'zip'; blobUrl: string; fileName: string }
  | { status: 'error'; message: string };

export default function BatchExport({ segments, jobNumber, jobName, operator }: Props) {
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const buildInputs = useCallback((): PdfInput[] => {
    return segments.map(({ segment, observations, mapImageDataUrl }) => ({
      segment,
      observations,
      jobNumber,
      jobName,
      operator,
      mapImageDataUrl,
    }));
  }, [segments, jobNumber, jobName, operator]);

  const handleExport = useCallback(
    async (mode: 'combined' | 'zip') => {
      if (segments.length === 0) return;
      if (!operator.trim()) {
        setExportState({
          status: 'error',
          message: 'Enter your name in the OPERATOR field at the top of the page before exporting.',
        });
        return;
      }

      cleanup();
      setExportState({ status: 'generating', current: 0, total: segments.length, mode });

      try {
        const inputs = buildInputs();
        const blob = await generateBatchPdf(inputs, mode, (current, total) => {
          setExportState({ status: 'generating', current, total, mode });
        });

        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        const ext = mode === 'zip' ? 'zip' : 'pdf';
        const fileName = `BLD_PrepSheets_Job${jobNumber || 'Unknown'}_${segments.length}segments.${ext}`;

        setExportState({ status: 'done', mode, blobUrl: url, fileName });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed';
        console.error('Batch export error:', err);
        setExportState({ status: 'error', message });
      }
    },
    [segments, buildInputs, cleanup, jobNumber, operator]
  );

  const handleDownload = useCallback(() => {
    if (exportState.status !== 'done') return;
    const a = document.createElement('a');
    a.href = exportState.blobUrl;
    a.download = exportState.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [exportState]);

  const handleReset = useCallback(() => {
    cleanup();
    setExportState({ status: 'idle' });
  }, [cleanup]);

  const isGenerating = exportState.status === 'generating';
  const segmentCount = segments.length;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <h3
            style={{
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: 15,
              margin: 0,
            }}
          >
            Batch Export
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              margin: '4px 0 0 0',
            }}
          >
            {segmentCount} segment{segmentCount !== 1 ? 's' : ''} selected for export
          </p>
        </div>

        {exportState.status === 'done' && (
          <button
            onClick={handleReset}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Idle state: export buttons */}
      {exportState.status === 'idle' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => handleExport('combined')}
            disabled={segmentCount === 0}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '16px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: segmentCount === 0 ? 'not-allowed' : 'pointer',
              opacity: segmentCount === 0 ? 0.4 : 1,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (segmentCount > 0) e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <span
              style={{
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Download Combined PDF
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              All segments in one file, one page each
            </span>
          </button>

          <button
            onClick={() => handleExport('zip')}
            disabled={segmentCount === 0}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '16px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: segmentCount === 0 ? 'not-allowed' : 'pointer',
              opacity: segmentCount === 0 ? 0.4 : 1,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (segmentCount > 0) e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span
              style={{
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Download as ZIP
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Individual PDFs in a ZIP archive
            </span>
          </button>
        </div>
      )}

      {/* Generating state: progress bar */}
      {exportState.status === 'generating' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BatchSpinner />
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Generating {exportState.mode === 'combined' ? 'combined PDF' : 'ZIP archive'}...
            </span>
          </div>

          {/* Progress bar */}
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'var(--bg-secondary)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(exportState.current / exportState.total) * 100}%`,
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 4,
                transition: 'width 0.2s ease',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 14,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              {exportState.current} of {exportState.total} segments
            </span>
            <span>{Math.round((exportState.current / exportState.total) * 100)}%</span>
          </div>
        </div>
      )}

      {/* Done state: download button */}
      {exportState.status === 'done' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '12px 0',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(63, 185, 80, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--success)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Export Complete
          </span>

          <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {exportState.fileName}
          </span>

          <button
            onClick={handleDownload}
            style={{
              marginTop: 4,
              background: 'var(--success)',
              border: 'none',
              color: 'white',
              borderRadius: 6,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download {exportState.mode === 'combined' ? 'PDF' : 'ZIP'}
          </button>
        </div>
      )}

      {/* Error state */}
      {exportState.status === 'error' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '12px 0',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(248, 81, 73, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--danger)',
              fontWeight: 700,
              fontSize: 20,
            }}
          >
            !
          </div>

          <span
            style={{
              color: 'var(--danger)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Export Failed
          </span>

          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              textAlign: 'center',
              maxWidth: 300,
            }}
          >
            {exportState.message}
          </span>

          <button
            onClick={handleReset}
            style={{
              marginTop: 6,
              background: 'var(--accent)',
              border: 'none',
              color: 'white',
              borderRadius: 6,
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

// ── Small spinning indicator ────────────────────────────────────────────────
function BatchSpinner() {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        border: '2px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'batch-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes batch-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

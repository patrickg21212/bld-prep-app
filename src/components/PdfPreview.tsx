import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Segment, SegmentObservations } from '../lib/types';
import type { PdfInput } from '../lib/pdf';
import { generatePrepSheetPdf } from '../lib/pdf';

interface Props {
  segment: Segment;
  observations: SegmentObservations;
  jobNumber: string;
  jobName: string;
  operator: string;
  mapImageDataUrl?: string;
  onBack: () => void;
}

export default function PdfPreview({
  segment,
  observations,
  jobNumber,
  jobName,
  operator,
  mapImageDataUrl,
  onBack,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevBlobUrl = useRef<string | null>(null);

  // Build the PdfInput from props
  const pdfInput: PdfInput = {
    segment,
    observations,
    jobNumber,
    jobName,
    operator,
    mapImageDataUrl,
  };

  // Serialize input to detect changes (stable comparison)
  const inputKey = JSON.stringify({
    repairNumber: segment.repairNumber,
    observations,
    jobNumber,
    jobName,
    operator,
    hasMap: !!mapImageDataUrl,
  });

  const generatePdf = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!operator.trim()) {
      setError('Enter your name in the OPERATOR field at the top of the page before previewing a PDF.');
      setLoading(false);
      return;
    }

    try {
      const doc = await generatePrepSheetPdf(pdfInput);
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);

      // Revoke previous blob URL to prevent memory leaks
      if (prevBlobUrl.current) {
        URL.revokeObjectURL(prevBlobUrl.current);
      }
      prevBlobUrl.current = url;
      setBlobUrl(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate PDF';
      setError(message);
      console.error('PDF generation error:', err);
    } finally {
      setLoading(false);
    }
  }, [inputKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate on mount and when input changes
  useEffect(() => {
    generatePdf();
  }, [generatePdf]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) {
        URL.revokeObjectURL(prevBlobUrl.current);
      }
    };
  }, []);

  const handleDownload = useCallback(() => {
    if (!blobUrl) return;

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `PrepSheet_Repair${segment.repairNumber}_${segment.streetName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [blobUrl, segment]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 80px)',
        gap: 0,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
          borderRadius: '8px 8px 0 0',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>&larr;</span>
            Back to Editor
          </button>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Repair #{segment.repairNumber}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {segment.streetName} &middot; PDF Preview
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={generatePdf}
            disabled={loading}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6" />
              <path d="M2.5 12a10 10 0 0 1 16.86-7.16L21.5 2" />
              <path d="M2.5 22v-6h6" />
              <path d="M21.5 12a10 10 0 0 1-16.86 7.16L2.5 22" />
            </svg>
            Regenerate
          </button>

          <button
            onClick={handleDownload}
            disabled={!blobUrl || loading}
            style={{
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
              color: 'white',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: !blobUrl || loading ? 'not-allowed' : 'pointer',
              opacity: !blobUrl || loading ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg
              width="14"
              height="14"
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
            Download PDF
          </button>
        </div>
      </div>

      {/* PDF Display Area */}
      <div
        style={{
          flex: 1,
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '0 0 8px 8px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {loading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <Spinner />
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Generating PDF...
            </span>
          </div>
        )}

        {error && !loading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: 24,
              maxWidth: 400,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(248, 81, 73, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              !
            </div>
            <span
              style={{
                color: 'var(--danger)',
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              PDF Generation Failed
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {error}
            </span>
            <button
              onClick={generatePdf}
              style={{
                marginTop: 8,
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

        {blobUrl && !loading && !error && (
          <iframe
            src={blobUrl + '#toolbar=1&navpanes=0'}
            title="PDF Preview"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#525659',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Loading spinner ─────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'pdf-spin 0.8s linear infinite',
      }}
    >
      <style>{`
        @keyframes pdf-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

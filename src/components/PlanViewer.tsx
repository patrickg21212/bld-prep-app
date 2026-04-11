import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source for pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface Props {
  /** Raw PDF bytes stored in IndexedDB */
  pdfData: ArrayBuffer;
  /** 1-based page number to display (from segment's sheetNumber field) */
  initialPage: number;
  /** Total pages in the PDF (shown in nav) */
  totalPages?: number;
  /** Called when user clicks to crop a region; returns cropped image data URL */
  onCrop: (croppedDataUrl: string, clickX: number, clickY: number) => void;
  onClose: () => void;
}

const RENDER_SCALE = 2; // High-res render for crisp crops
const CROP_SIZE = 400;  // Crop region size in PDF points (adjustable)

export default function PlanViewer({ pdfData, initialPage, totalPages, onCrop, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(totalPages ?? 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [cropSize, setCropSize] = useState(CROP_SIZE);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });

  const pdfDocRef = useRef<any>(null);
  const pageDataRef = useRef<{ width: number; height: number; scale: number }>({ width: 0, height: 0, scale: 1 });

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);
        const data = new Uint8Array(pdfData);
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        // Clamp page to valid range
        if (page > doc.numPages) setPage(doc.numPages);
        if (page < 1) setPage(1);
      } catch (e) {
        if (!cancelled) setError('Failed to load PDF: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
    loadPdf();
    return () => { cancelled = true; };
  }, [pdfData]);

  // Render current page
  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      const doc = pdfDocRef.current;
      if (!doc || !canvasRef.current) return;
      try {
        setLoading(true);
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        pageDataRef.current = { width: viewport.width, height: viewport.height, scale: RENDER_SCALE };

        const ctx = canvas.getContext('2d')!;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Failed to render page: ' + (e instanceof Error ? e.message : String(e)));
          setLoading(false);
        }
      }
    }
    renderPage();
    return () => { cancelled = true; };
  }, [page, pdfDocRef.current]);

  // Reset pan/zoom when page changes
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [page]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.3, Math.min(5, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey) {
      // Middle-click or alt+click = pan
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
    // Update cursor position for crop preview
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
    }
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setCursor(c => ({ ...c, visible: false }));
  }, []);

  // Click to crop
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isPanning) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    // Mouse position relative to the displayed canvas
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;

    // Convert to actual canvas pixel coordinates
    const displayWidth = canvasRect.width;
    const displayHeight = canvasRect.height;
    const canvasX = (mouseX / displayWidth) * canvas.width;
    const canvasY = (mouseY / displayHeight) * canvas.height;

    // Crop region in canvas pixels
    const cropPixels = cropSize * RENDER_SCALE;
    const halfCrop = cropPixels / 2;
    const sx = Math.max(0, Math.min(canvas.width - cropPixels, canvasX - halfCrop));
    const sy = Math.max(0, Math.min(canvas.height - cropPixels, canvasY - halfCrop));
    const sw = Math.min(cropPixels, canvas.width - sx);
    const sh = Math.min(cropPixels, canvas.height - sy);

    // Create cropped canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const dataUrl = cropCanvas.toDataURL('image/png');

    // Calculate click position relative to crop (for placing the ellipse)
    const clickInCropX = canvasX - sx;
    const clickInCropY = canvasY - sy;
    const relX = clickInCropX / sw; // 0-1 relative position
    const relY = clickInCropY / sh;

    onCrop(dataUrl, relX, relY);
  }, [isPanning, cropSize, onCrop]);

  // Crop preview overlay dimensions
  const getPreviewRect = () => {
    if (!cursor.visible || !canvasRef.current || !containerRef.current) return null;
    const canvas = canvasRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const displayScale = canvasRect.width / canvas.width;
    const size = cropSize * RENDER_SCALE * displayScale;
    return {
      left: cursor.x - size / 2,
      top: cursor.y - size / 2,
      width: size,
      height: size,
    };
  };

  const preview = getPreviewRect();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Toolbar */}
      <div style={{
        background: 'var(--nav-bg)', padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0,
      }}>
        <button onClick={onClose} style={toolBtnStyle}>
          &times; Close
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'white' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...toolBtnStyle, opacity: page <= 1 ? 0.4 : 1 }}
          >
            &larr;
          </button>
          <span style={{ fontSize: 14, minWidth: 80, textAlign: 'center' }}>
            Page {page} / {numPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(numPages, p + 1))}
            disabled={page >= numPages}
            style={{ ...toolBtnStyle, opacity: page >= numPages ? 0.4 : 1 }}
          >
            &rarr;
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'white' }}>
          <button onClick={() => setZoom(z => Math.max(0.3, z * 0.8))} style={toolBtnStyle}>-</button>
          <span style={{ fontSize: 14, minWidth: 50, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(5, z * 1.25))} style={toolBtnStyle}>+</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={toolBtnStyle}>Fit</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'white', marginLeft: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Crop size:</span>
          <input
            type="range" min={200} max={800} step={50} value={cropSize}
            onChange={e => setCropSize(Number(e.target.value))}
            style={{ width: 100, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 13, minWidth: 30 }}>{cropSize}</span>
        </div>

        <div style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          Click on a segment to crop &middot; Alt+drag to pan &middot; Scroll to zoom
        </div>
      </div>

      {/* PDF canvas area */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          cursor: isPanning ? 'grabbing' : 'crosshair',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 16, zIndex: 2,
          }}>
            Loading page {page}...
          </div>
        )}

        {error && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--danger)', fontSize: 16, zIndex: 2,
          }}>
            {error}
          </div>
        )}

        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            transformOrigin: 'center center',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            left: '50%',
            top: '50%',
            marginLeft: -(pageDataRef.current.width / 2),
            marginTop: -(pageDataRef.current.height / 2),
            maxWidth: 'none',
          }}
        />

        {/* Crop preview rectangle */}
        {preview && !isPanning && (
          <div style={{
            position: 'absolute',
            left: preview.left,
            top: preview.top,
            width: preview.width,
            height: preview.height,
            border: '2px solid rgba(47, 129, 247, 0.8)',
            background: 'rgba(47, 129, 247, 0.08)',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 3,
          }} />
        )}
      </div>
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.2)',
  color: 'white',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

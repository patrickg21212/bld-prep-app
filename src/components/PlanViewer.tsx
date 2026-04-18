import React, { useEffect, useRef, useState, useCallback } from 'react';

// Load pdf.js via script tag — most reliable cross-browser method
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

let pdfjsPromise: Promise<any> | null = null;

function getPdfjs(): Promise<any> {
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) { reject(new Error('pdf.js not found on window')); return; }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      resolve(lib);
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

interface Props {
  pdfData: ArrayBuffer;
  initialPage: number;
  sheetPages?: number[];  // All pages for this sheet (satellite-preferred first)
  totalPages?: number;
  onCrop: (croppedDataUrl: string, clickX: number, clickY: number) => void;
  onClose: () => void;
}

const RENDER_SCALE = 1.5;
const CROP_SIZE_DEFAULT = 400;
const DRAG_THRESHOLD = 5;

interface CropState {
  dataUrl: string;
  relX: number;
  relY: number;
}

export default function PlanViewer({ pdfData, initialPage, sheetPages, totalPages, onCrop, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(totalPages ?? 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cropSize, setCropSize] = useState(CROP_SIZE_DEFAULT);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });

  // Crop marker: placed on click, confirmed with button
  const [cropMarker, setCropMarker] = useState<{ canvasX: number; canvasY: number } | null>(null);

  // Stitch mode: crop two areas (different pages) and combine side-by-side
  const [stitchMode, setStitchMode] = useState(false);
  const [firstCrop, setFirstCrop] = useState<CropState | null>(null);

  // Drag state
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0, moved: false });

  const pdfDocRef = useRef<any>(null);
  const pageDataRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const renderTaskRef = useRef<any>(null);
  const [docReady, setDocReady] = useState(false);

  // Sync page when initialPage prop changes (different segment opened, same PDF loaded)
  useEffect(() => {
    const docPages = pdfDocRef.current?.numPages;
    const clamped = docPages ? Math.max(1, Math.min(initialPage, docPages)) : initialPage;
    setPage(clamped);
  }, [initialPage]);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);
        setDocReady(false);
        const pdfjs = await getPdfjs();
        const data = new Uint8Array(pdfData.slice(0));
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        const clamped = Math.max(1, Math.min(initialPage, doc.numPages));
        setPage(clamped);
        setDocReady(true);
      } catch (e) {
        if (!cancelled) setError('Failed to load PDF: ' + (e instanceof Error ? e.message : String(e)));
        setLoading(false);
      }
    }
    loadPdf();
    return () => { cancelled = true; };
  }, [pdfData]);

  // Render current page — cancel any in-flight render before starting a new one
  useEffect(() => {
    if (!docReady) return;
    let cancelled = false;

    async function doRender() {
      const doc = pdfDocRef.current;
      if (!doc || !canvasRef.current) return;

      // Cancel previous render before touching the canvas
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }

      try {
        setLoading(true);
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        pageDataRef.current = { width: viewport.width, height: viewport.height };

        const ctx = canvas.getContext('2d')!;
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        try {
          await task.promise;
        } catch (e: any) {
          // pdf.js throws RenderingCancelledException when cancel() wins the race — ignore
          if (e?.name === 'RenderingCancelledException') return;
          throw e;
        }
        if (cancelled) return;
        renderTaskRef.current = null;

        // Auto-fit: calculate zoom to fit page in container
        const container = containerRef.current;
        if (container) {
          const containerW = container.clientWidth;
          const containerH = container.clientHeight;
          const fitZoom = Math.min(
            containerW / viewport.width,
            containerH / viewport.height,
          ) * 0.95;
          setZoom(fitZoom);
          setPan({ x: 0, y: 0 });
        }

        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Failed to render page: ' + (e instanceof Error ? e.message : String(e)));
          setLoading(false);
        }
      }
    }
    doRender();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [page, docReady]);

  // Reset crop marker when page changes
  useEffect(() => {
    setCropMarker(null);
  }, [page]);

  // Scroll to zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.1, Math.min(5, z * delta)));
  }, []);

  // Drag to pan (any click)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (d.active) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        d.moved = true;
      }
      setPan({ x: d.startPanX + dx, y: d.startPanY + dy });
    }
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (d.active && !d.moved) {
      const canvas = canvasRef.current;
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;
        const canvasX = (mouseX / canvasRect.width) * canvas.width;
        const canvasY = (mouseY / canvasRect.height) * canvas.height;
        setCropMarker({ canvasX, canvasY });
      }
    }
    dragRef.current.active = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragRef.current.active = false;
    setCursor(c => ({ ...c, visible: false }));
  }, []);

  // Extract crop from canvas at current marker
  const extractCrop = useCallback((): CropState | null => {
    if (!cropMarker) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const { canvasX, canvasY } = cropMarker;
    const cropPixels = cropSize * RENDER_SCALE;
    const halfCrop = cropPixels / 2;
    const sx = Math.max(0, Math.min(canvas.width - cropPixels, canvasX - halfCrop));
    const sy = Math.max(0, Math.min(canvas.height - cropPixels, canvasY - halfCrop));
    const sw = Math.min(cropPixels, canvas.width - sx);
    const sh = Math.min(cropPixels, canvas.height - sy);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const dataUrl = cropCanvas.toDataURL('image/png');
    const relX = (canvasX - sx) / sw;
    const relY = (canvasY - sy) / sh;
    return { dataUrl, relX, relY };
  }, [cropMarker, cropSize]);

  // Stitch two crops side-by-side and call onCrop
  const stitchAndCrop = useCallback((first: CropState, second: CropState) => {
    const img1 = new Image();
    const img2 = new Image();
    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;
      const gap = 6;
      const h = Math.max(img1.height, img2.height);
      const stitchedCanvas = document.createElement('canvas');
      stitchedCanvas.width = img1.width + gap + img2.width;
      stitchedCanvas.height = h;
      const ctx = stitchedCanvas.getContext('2d')!;
      // Dark divider
      ctx.fillStyle = '#444';
      ctx.fillRect(img1.width, 0, gap, h);
      ctx.drawImage(img1, 0, (h - img1.height) / 2);
      ctx.drawImage(img2, img1.width + gap, (h - img2.height) / 2);
      const dataUrl = stitchedCanvas.toDataURL('image/png');
      // Click position in center of first crop (left side)
      const relX = (img1.width * first.relX) / stitchedCanvas.width;
      const relY = first.relY;
      onCrop(dataUrl, relX, relY);
    };
    img1.onload = onLoad;
    img2.onload = onLoad;
    img1.src = first.dataUrl;
    img2.src = second.dataUrl;
  }, [onCrop]);

  // Confirm crop at marker position
  const confirmCrop = useCallback(() => {
    const crop = extractCrop();
    if (!crop) return;

    if (stitchMode && !firstCrop) {
      // Save first crop, clear marker so user can pick second
      setFirstCrop(crop);
      setCropMarker(null);
    } else if (stitchMode && firstCrop) {
      // Stitch and finish
      stitchAndCrop(firstCrop, crop);
    } else {
      onCrop(crop.dataUrl, crop.relX, crop.relY);
    }
  }, [extractCrop, stitchMode, firstCrop, stitchAndCrop, onCrop]);

  // Cancel stitch mode / first crop
  const cancelStitch = useCallback(() => {
    setFirstCrop(null);
    setCropMarker(null);
    setStitchMode(false);
  }, []);

  // Fit page to container
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const { width, height } = pageDataRef.current;
    if (!container || !width) return;
    const fitZoom = Math.min(
      container.clientWidth / width,
      container.clientHeight / height,
    ) * 0.95;
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, []);

  // Get crop marker position in screen coordinates for overlay
  const getMarkerScreenRect = () => {
    if (!cropMarker || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return null;

    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const cropPixels = cropSize * RENDER_SCALE;

    const sx = Math.max(0, Math.min(canvas.width - cropPixels, cropMarker.canvasX - cropPixels / 2));
    const sy = Math.max(0, Math.min(canvas.height - cropPixels, cropMarker.canvasY - cropPixels / 2));

    return {
      left: canvasRect.left - containerRect.left + sx * scaleX,
      top: canvasRect.top - containerRect.top + sy * scaleY,
      width: Math.min(cropPixels, canvas.width - sx) * scaleX,
      height: Math.min(cropPixels, canvas.height - sy) * scaleY,
    };
  };

  const markerRect = getMarkerScreenRect();

  // Which page label to show for quick-jump
  const otherSheetPages = sheetPages ? sheetPages.filter(p => p !== page) : [];

  // Stitch crop button label
  const cropBtnLabel = stitchMode
    ? (firstCrop ? 'Crop Here (Part 2 — will stitch)' : 'Crop Here (Part 1 of 2)')
    : 'Crop Here';
  const cropBtnColor = stitchMode
    ? (firstCrop ? '#e36b00' : '#2f81f7')
    : '#2f81f7';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Toolbar */}
      <div style={{
        background: 'var(--nav-bg)', padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button onClick={onClose} style={toolBtnStyle}>&times; Close</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'white' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ ...toolBtnStyle, opacity: page <= 1 ? 0.4 : 1 }}>&larr;</button>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Pg</span>
          <input
            type="number"
            min={1}
            max={numPages}
            value={page}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1 && v <= numPages) setPage(v);
            }}
            style={{
              width: 52, background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4,
              color: 'white', fontSize: 14, padding: '3px 6px',
              textAlign: 'center',
            }}
          />
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>/ {numPages}</span>
          <button onClick={() => setPage(p => Math.min(numPages, p + 1))} disabled={page >= numPages}
            style={{ ...toolBtnStyle, opacity: page >= numPages ? 0.4 : 1 }}>&rarr;</button>
        </div>

        {/* Quick-jump buttons for sheet pages */}
        {sheetPages && sheetPages.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {sheetPages.map((p, i) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  ...toolBtnStyle,
                  background: page === p ? 'rgba(47,129,247,0.3)' : 'rgba(255,255,255,0.08)',
                  borderColor: page === p ? '#2f81f7' : 'rgba(255,255,255,0.2)',
                  color: page === p ? '#2f81f7' : 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                  padding: '3px 8px',
                }}
              >
                Pg {p}{i === 0 ? ' ★' : ''}
              </button>
            ))}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 2 }}>★=aerial</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'white' }}>
          <button onClick={() => setZoom(z => Math.max(0.1, z * 0.8))} style={toolBtnStyle}>-</button>
          <span style={{ fontSize: 14, minWidth: 50, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(5, z * 1.25))} style={toolBtnStyle}>+</button>
          <button onClick={fitToView} style={toolBtnStyle}>Fit</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'white' }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Crop size:</span>
          <input type="range" min={150} max={800} step={50} value={cropSize}
            onChange={e => setCropSize(Number(e.target.value))}
            style={{ width: 100, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 13, minWidth: 30 }}>{cropSize}</span>
        </div>

        {/* Stitch mode toggle */}
        <button
          onClick={() => {
            if (stitchMode) { cancelStitch(); } else { setStitchMode(true); }
          }}
          title="Stitch two crops side-by-side (for segments that span two pages)"
          style={{
            ...toolBtnStyle,
            background: stitchMode ? 'rgba(227,107,0,0.25)' : 'rgba(255,255,255,0.08)',
            borderColor: stitchMode ? '#e36b00' : 'rgba(255,255,255,0.2)',
            color: stitchMode ? '#e36b00' : 'rgba(255,255,255,0.7)',
            fontSize: 13,
          }}
        >
          {stitchMode ? '✕ Cancel Stitch' : '⊕ Stitch 2 Pages'}
        </button>

        {/* Confirm crop button */}
        {cropMarker && (
          <button onClick={confirmCrop} style={{
            background: cropBtnColor, border: 'none', color: 'white',
            borderRadius: 4, padding: '6px 16px', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', marginLeft: 4,
          }}>
            {cropBtnLabel}
          </button>
        )}

        <div style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          Drag to pan &middot; Scroll to zoom &middot; Click to mark &middot; Then confirm
        </div>
      </div>

      {/* Stitch mode status bar */}
      {stitchMode && (
        <div style={{
          background: firstCrop ? 'rgba(227,107,0,0.15)' : 'rgba(47,129,247,0.12)',
          borderBottom: `1px solid ${firstCrop ? '#e36b00' : '#2f81f7'}`,
          padding: '6px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          flexShrink: 0,
        }}>
          {!firstCrop ? (
            <span style={{ color: '#2f81f7', fontSize: 13, fontWeight: 600 }}>
              Stitch Mode: Click the <strong>first</strong> page area (left side of segment), then "Crop Here (Part 1 of 2)".
            </span>
          ) : (
            <>
              <span style={{ color: '#e36b00', fontSize: 13, fontWeight: 600 }}>
                ✓ Part 1 saved. Navigate to the <strong>second</strong> page, click the other half, then "Crop Here (Part 2 — will stitch)".
              </span>
              <img
                src={firstCrop.dataUrl}
                alt="First crop"
                style={{ height: 32, border: '1px solid #e36b00', borderRadius: 3, opacity: 0.85 }}
              />
            </>
          )}
        </div>
      )}

      {/* PDF canvas area */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          cursor: dragRef.current.active ? 'grabbing' : 'grab',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
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

        {/* Crop marker rectangle */}
        {markerRect && !loading && (
          <div style={{
            position: 'absolute',
            left: markerRect.left,
            top: markerRect.top,
            width: markerRect.width,
            height: markerRect.height,
            border: `3px solid ${stitchMode && firstCrop ? '#e36b00' : '#2f81f7'}`,
            background: stitchMode && firstCrop ? 'rgba(227,107,0,0.1)' : 'rgba(47, 129, 247, 0.1)',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 3,
          }}>
            <div style={{
              position: 'absolute', top: -24, left: '50%', transform: 'translateX(-50%)',
              background: stitchMode && firstCrop ? '#e36b00' : '#2f81f7',
              color: 'white', fontSize: 12, fontWeight: 600,
              padding: '2px 8px', borderRadius: 3, whiteSpace: 'nowrap',
            }}>
              {stitchMode
                ? (firstCrop ? 'Part 2 — click "Crop Here" to stitch' : 'Part 1 — click "Crop Here" to save')
                : 'Click "Crop Here" to confirm'}
            </div>
          </div>
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

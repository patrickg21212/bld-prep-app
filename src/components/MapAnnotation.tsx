import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { Stage, Layer, Image as KImage, Ellipse, Text as KText } from 'react-konva';
import Konva from 'konva';

import type { AnnotationData } from '../lib/types';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type { AnnotationData };

export interface MapAnnotationProps {
  /** Pre-loaded raw image data URL (if resuming a draft) */
  initialImage?: string;
  /** Pre-loaded annotations (if resuming a draft) */
  initialAnnotations?: AnnotationData[];
  /** Callback when annotations change — compositeUrl has annotations baked in (for PDF), rawUrl is the original image */
  onChange: (compositeDataUrl: string | null, rawImageDataUrl: string | null, annotations: AnnotationData[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type ToolMode = 'select' | 'circle' | 'text';

const PRESET_COLORS = [
  { label: 'Yellow', value: '#FFD700' },
  { label: 'Orange', value: '#FF6B00' },
  { label: 'Red', value: '#FF3333' },
  { label: 'Blue', value: '#3B82F6' },
  { label: 'White', value: '#FFFFFF' },
];

const STROKE_WIDTHS = [2, 3, 5] as const;

const MIN_STAGE_H = 500;

const uid = () => `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/*  Styles (inline, matching project dark-mode CSS vars)               */
/* ------------------------------------------------------------------ */

const S = {
  wrapper: {
    background: 'var(--bg-card, #21262d)',
    border: '1px solid var(--border, #30363d)',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-md, 0 2px 8px rgba(0,0,0,0.08))',
  } as React.CSSProperties,
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border, #30363d)',
    flexWrap: 'wrap',
  } as React.CSSProperties,
  btn: (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent, #2f81f7)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary, #8b949e)',
    border: '1px solid ' + (active ? 'var(--accent, #2f81f7)' : 'var(--border, #30363d)'),
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 14,
    cursor: 'pointer',
    lineHeight: '1.4',
    userSelect: 'none',
  }),
  separator: {
    width: 1,
    height: 24,
    background: 'var(--border, #30363d)',
    margin: '0 4px',
  } as React.CSSProperties,
  colorSwatch: (color: string, active: boolean): React.CSSProperties => ({
    width: 20,
    height: 20,
    borderRadius: 4,
    background: color,
    border: active ? '2px solid var(--accent, #2f81f7)' : '2px solid var(--border, #30363d)',
    cursor: 'pointer',
    boxSizing: 'border-box',
  }),
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_STAGE_H,
    color: 'var(--text-secondary, #8b949e)',
    fontSize: 15,
    cursor: 'pointer',
    padding: 40,
  } as React.CSSProperties,
  dropActive: {
    outline: '2px dashed var(--accent, #2f81f7)',
    outlineOffset: -4,
  } as React.CSSProperties,
  canvasWrap: {
    position: 'relative',
    minHeight: MIN_STAGE_H,
    overflow: 'hidden',
    cursor: 'crosshair',
  } as React.CSSProperties,
  label: {
    color: 'var(--text-secondary, #8b949e)',
    fontSize: 14,
    marginRight: 2,
  } as React.CSSProperties,
  textInput: {
    position: 'absolute',
    background: 'var(--bg-card, #21262d)',
    color: 'var(--text-primary, #e6edf3)',
    border: '1px solid var(--accent, #2f81f7)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 14,
    outline: 'none',
    zIndex: 100,
    minWidth: 120,
  } as React.CSSProperties,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapAnnotation({
  initialImage,
  initialAnnotations,
  onChange,
}: MapAnnotationProps) {
  /* ---- refs ------------------------------------------------------- */
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ---- state ------------------------------------------------------ */
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(initialImage ?? null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  const [annotations, setAnnotations] = useState<AnnotationData[]>(initialAnnotations ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sync when initialImage/initialAnnotations change from outside (e.g. PlanViewer crop)
  useEffect(() => {
    if (initialImage !== undefined) {
      const hadImageBefore = imageDataUrl !== null;
      setImageDataUrl(initialImage ?? null);
      // When a fresh crop arrives, drop straight into ellipse-draw mode so
      // the worker can drag from one end of the pipe to the other and get a
      // correctly-oriented annotation in a single gesture. Auto-placement
      // always guessed wrong, so we hand them the tool instead.
      if (initialImage && !hadImageBefore) {
        setTool('circle');
        setSelectedId(null);
      }
    }
  }, [initialImage]);

  useEffect(() => {
    if (initialAnnotations !== undefined) {
      setAnnotations(initialAnnotations ?? []);
    }
  }, [initialAnnotations]);

  // Undo / redo stacks hold full snapshots for simplicity
  const [undoStack, setUndoStack] = useState<AnnotationData[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationData[][]>([]);

  const [tool, setTool] = useState<ToolMode>('select');
  const [activeColor, setActiveColor] = useState('#FFD700');
  const [activeStroke, setActiveStroke] = useState<number>(3);

  // Stage dimensions
  const [stageW, setStageW] = useState(800);
  const [stageH, setStageH] = useState(MIN_STAGE_H);

  // Pan / zoom
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Drawing in progress (circle tool)
  const [drawing, setDrawing] = useState(false);
  const [drawOrigin, setDrawOrigin] = useState<{ x: number; y: number } | null>(null);
  const [drawPreview, setDrawPreview] = useState<AnnotationData | null>(null);

  // Inline text input
  const [textInput, setTextInput] = useState<{ x: number; y: number; stageX: number; stageY: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  // Drag-and-drop hover
  const [dropActive, setDropActive] = useState(false);

  /* ---- helpers: undo system --------------------------------------- */
  const pushUndo = useCallback(
    (prev: AnnotationData[]) => {
      setUndoStack((s) => [...s, prev]);
      setRedoStack([]);
    },
    [],
  );

  const commitAnnotations = useCallback(
    (next: AnnotationData[], prev?: AnnotationData[]) => {
      if (prev) pushUndo(prev);
      setAnnotations(next);
    },
    [pushUndo],
  );

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      const rest = stack.slice(0, -1);
      setRedoStack((r) => [...r, annotations]);
      setAnnotations(prev);
      return rest;
    });
    setSelectedId(null);
  }, [annotations]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      const rest = stack.slice(0, -1);
      setUndoStack((u) => [...u, annotations]);
      setAnnotations(next);
      return rest;
    });
    setSelectedId(null);
  }, [annotations]);

  /* ---- fire onChange on annotation / image mutations --------------- */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Save the annotations array IMMEDIATELY on every change. The composite
  // image (circle baked into the map PNG, for PDF export) is generated
  // asynchronously below — if that async work is interrupted (navigation,
  // unmount), the annotations themselves are already persisted and will
  // re-render from state on next visit.
  useEffect(() => {
    onChangeRef.current(imageDataUrl, imageDataUrl, annotations);
    // Intentionally excluding onChange from deps — we want this to fire on
    // every real state change, not every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrl, annotations]);

  // Composite generation: runs after Konva has painted, bakes annotations
  // into the exported image so the PDF preview shows them.
  //
  // Defensive: if the user is mid-drag (drawing === true), do NOT call
  // toDataURL — it's a synchronous full-canvas read that reliably causes
  // visible flicker on the preview shape mid-drag. The dep list means this
  // effect shouldn't fire during a drag at all (annotations/imageDataUrl
  // don't change until mouseup), but belt-and-suspenders prevents any
  // future refactor from accidentally wiring it into the drag path.
  useEffect(() => {
    if (!loadedImage) return;
    if (drawing) return;
    // When annotations are cleared (user deleted the last one), the previously
    // saved composite still has the baked-in circle — exported PDFs would show
    // a ghost mark. Overwrite the composite with the raw image so the stale
    // pixels are flushed. Do NOT early-return without updating.
    if (annotations.length === 0) {
      onChangeRef.current(imageDataUrl, imageDataUrl, []);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const composite = stageRef.current?.toDataURL({ pixelRatio: 2 });
      if (composite) {
        onChangeRef.current(composite, imageDataUrl, annotations);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [imageDataUrl, annotations, loadedImage, drawing]);

  /* ---- load image from data URL ----------------------------------- */
  useEffect(() => {
    if (!imageDataUrl) {
      setLoadedImage(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setLoadedImage(img);
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  /* ---- fit image to container on load ----------------------------- */
  useEffect(() => {
    if (!loadedImage || !containerRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const imgW = loadedImage.naturalWidth;
    const imgH = loadedImage.naturalHeight;
    const fitScale = Math.min(containerW / imgW, MIN_STAGE_H / imgH, 1);
    const w = Math.max(containerW, imgW * fitScale);
    const h = Math.max(MIN_STAGE_H, imgH * fitScale);
    setStageW(w);
    setStageH(h);
    setScale(fitScale);
    setPosition({
      x: (w - imgW * fitScale) / 2,
      y: (h - imgH * fitScale) / 2,
    });
  }, [loadedImage]);

  /* ---- resize observer -------------------------------------------- */
  // Round to whole pixels and only update when the width actually changes —
  // a naive setStageW(contentRect.width) creates a feedback loop on some
  // browsers: the canvas resize nudges the container width by a sub-pixel,
  // ResizeObserver fires, we setState, Konva re-lays out, container width
  // nudges again. Symptom: the preview shape flickers during drag because
  // the Stage is being remounted on every frame.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        setStageW((prev) => (prev === w ? prev : w));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* ---- keyboard: delete, undo/redo -------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Delete selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        // Prevent browser back navigation
        e.preventDefault();
        const prev = [...annotations];
        commitAnnotations(
          annotations.filter((a) => a.id !== selectedId),
          prev,
        );
        setSelectedId(null);
        return;
      }
      // Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      // Escape cancels drawing / text input / deselects
      if (e.key === 'Escape') {
        setDrawing(false);
        setDrawPreview(null);
        setTextInput(null);
        setTextValue('');
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annotations, selectedId, commitAnnotations, undo, redo]);

  /* ---- file load helpers ------------------------------------------ */
  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setImageDataUrl(url);
      setAnnotations([]);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedId(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(true);
  }, []);
  const onDragLeave = useCallback(() => setDropActive(false), []);

  const onFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
      // reset so the same file can be re-selected
      e.target.value = '';
    },
    [loadFile],
  );

  /* ---- pointer helpers (convert screen -> canvas coords) ---------- */
  const screenToCanvas = useCallback(
    (px: number, py: number) => {
      return {
        x: (px - position.x) / scale,
        y: (py - position.y) / scale,
      };
    },
    [position, scale],
  );

  /* ---- stage event handlers --------------------------------------- */
  const onStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle-click drag for panning is handled by onWheel and native drag via position.
      // If middle button, just return.
      if (e.evt.button === 1) return;

      const stage = e.target.getStage();
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const canvasPos = screenToCanvas(pointer.x, pointer.y);

      if (tool === 'circle') {
        setDrawing(true);
        setDrawOrigin(canvasPos);
        setDrawPreview(null);
        setSelectedId(null);
        return;
      }

      if (tool === 'text') {
        // Place text input at pointer screen position
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;
        setTextInput({
          x: pointer.x + containerRect.left - (containerRect.left),
          y: pointer.y,
          stageX: canvasPos.x,
          stageY: canvasPos.y,
        });
        setTextValue('');
        setSelectedId(null);
        return;
      }

      // Select tool: check if we clicked on an annotation shape
      const clickedOnEmpty = e.target === stage || e.target.getClassName() === 'Image';
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
    },
    [tool, screenToCanvas],
  );

  const onStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!drawing || !drawOrigin) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const canvasPos = screenToCanvas(pointer.x, pointer.y);

      // Drag from A → B draws an ellipse *along* that line, rotated to match.
      // Pipe segments are straight lines (horizontal, vertical, or diagonal),
      // so the major axis tracks the drag direction and the minor axis is a
      // fixed-ish thickness that the worker tunes with Taller/Shorter.
      const dx = canvasPos.x - drawOrigin.x;
      const dy = canvasPos.y - drawOrigin.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const cx = (canvasPos.x + drawOrigin.x) / 2;
      const cy = (canvasPos.y + drawOrigin.y) / 2;
      const rotationDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const rx = length / 2;
      // Default thickness = 22% of length, with min/max so short segments
      // still read as ovals and long ones don't balloon.
      const ry = Math.max(8, Math.min(rx * 0.22, 60));

      setDrawPreview({
        id: '__preview__',
        type: 'circle',
        x: cx,
        y: cy,
        radiusX: rx,
        radiusY: ry,
        rotation: rotationDeg,
        stroke: activeColor,
        strokeWidth: activeStroke,
      });
    },
    [drawing, drawOrigin, activeColor, activeStroke, screenToCanvas],
  );

  const onStageMouseUp = useCallback(() => {
    if (!drawing || !drawPreview) {
      setDrawing(false);
      return;
    }
    // Only commit if the ellipse has meaningful size
    if ((drawPreview.radiusX ?? 0) > 3 || (drawPreview.radiusY ?? 0) > 3) {
      const newAnn: AnnotationData = { ...drawPreview, id: uid() };
      commitAnnotations([...annotations, newAnn], [...annotations]);
      // Drop out of draw mode and select the new ellipse so the Edit Circle
      // toolbar appears immediately — the worker can reshape / rotate / drag
      // without hunting for the Select tool first.
      setTool('select');
      setSelectedId(newAnn.id);
    }
    setDrawing(false);
    setDrawOrigin(null);
    setDrawPreview(null);
  }, [drawing, drawPreview, annotations, commitAnnotations]);

  /* ---- wheel zoom ------------------------------------------------- */
  const onWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const scaleBy = 1.08;
      const oldScale = scale;
      const newScale =
        e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

      const clampedScale = Math.max(0.1, Math.min(newScale, 10));

      // Zoom toward pointer
      const mousePointTo = {
        x: (pointer.x - position.x) / oldScale,
        y: (pointer.y - position.y) / oldScale,
      };
      const newPos = {
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      };

      setScale(clampedScale);
      setPosition(newPos);
    },
    [scale, position],
  );

  /* ---- panning (select mode or middle mouse) ---------------------- */
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  const onPanStart = useCallback(
    (e: React.MouseEvent) => {
      // Middle-click always pans. Left-click pans only in select mode AND
      // only when the click is on the map image, not on an annotation —
      // otherwise the pan handler hijacks mousedowns meant for dragging a
      // shape, and the ellipse appears welded to the map.
      if (e.button === 1) {
        isPanning.current = true;
        panStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
        return;
      }
      if (tool === 'select' && e.button === 0) {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const hit = stage.getIntersection(pointer);
        // getIntersection returns the topmost shape under the cursor. If
        // that's a shape (Ellipse/Text), let Konva drag it. Only pan when
        // the hit is empty or the background Image.
        const hitClass = hit?.getClassName();
        if (hit && hitClass !== 'Image') return;
        isPanning.current = true;
        panStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      }
    },
    [tool, position],
  );

  const onPanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning.current) return;
      setPosition({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
    },
    [],
  );

  const onPanEnd = useCallback(() => {
    isPanning.current = false;
  }, []);

  /* ---- annotation click (selection) ------------------------------- */
  const onAnnotationClick = useCallback(
    (id: string) => {
      if (tool === 'select') {
        setSelectedId(id);
      }
    },
    [tool],
  );

  /* ---- annotation drag end (update position) ---------------------- */
  const onAnnotationDragEnd = useCallback(
    (id: string, newX: number, newY: number) => {
      const prev = [...annotations];
      const next = annotations.map((a) =>
        a.id === id ? { ...a, x: newX, y: newY } : a,
      );
      commitAnnotations(next, prev);
    },
    [annotations, commitAnnotations],
  );

  /* ---- selected-ellipse edit helpers (touch-friendly buttons) ----- */
  const selectedEllipse = useMemo(
    () => annotations.find((a) => a.id === selectedId && a.type === 'circle') ?? null,
    [annotations, selectedId],
  );

  const mutateSelected = useCallback(
    (patch: (a: AnnotationData) => AnnotationData) => {
      if (!selectedId) return;
      const prev = [...annotations];
      const next = annotations.map((a) => (a.id === selectedId ? patch(a) : a));
      commitAnnotations(next, prev);
    },
    [annotations, selectedId, commitAnnotations],
  );

  const scaleAxis = useCallback(
    (axis: 'x' | 'y', factor: number) => {
      mutateSelected((a) => {
        const key = axis === 'x' ? 'radiusX' : 'radiusY';
        const current = a[key] ?? 20;
        const nextVal = Math.max(4, Math.min(current * factor, 4000));
        return { ...a, [key]: nextVal };
      });
    },
    [mutateSelected],
  );

  const rotateSelected = useCallback(
    (delta: number) => {
      mutateSelected((a) => ({ ...a, rotation: ((a.rotation ?? 0) + delta) % 360 }));
    },
    [mutateSelected],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const prev = [...annotations];
    commitAnnotations(
      annotations.filter((a) => a.id !== selectedId),
      prev,
    );
    setSelectedId(null);
  }, [annotations, selectedId, commitAnnotations]);

  /* ---- commit text label ------------------------------------------ */
  const commitText = useCallback(() => {
    if (!textInput || !textValue.trim()) {
      setTextInput(null);
      setTextValue('');
      return;
    }
    const newAnn: AnnotationData = {
      id: uid(),
      type: 'text',
      x: textInput.stageX,
      y: textInput.stageY,
      text: textValue.trim(),
      fontSize: 16,
      fill: activeColor,
    };
    commitAnnotations([...annotations, newAnn], [...annotations]);
    setTextInput(null);
    setTextValue('');
  }, [textInput, textValue, activeColor, annotations, commitAnnotations]);

  /* ---- export ----------------------------------------------------- */
  const exportDataUrl = useCallback((): string | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    return stage.toDataURL({ pixelRatio: 2 });
  }, []);

  // Expose export on window for parent components to call imperatively
  useEffect(() => {
    (window as any).__mapAnnotationExport = exportDataUrl;
    return () => {
      delete (window as any).__mapAnnotationExport;
    };
  }, [exportDataUrl]);

  /* ---- cursor based on tool --------------------------------------- */
  const cursor = useMemo(() => {
    if (tool === 'circle') return 'crosshair';
    if (tool === 'text') return 'text';
    return 'grab';
  }, [tool]);

  /* ---- render: no image loaded yet -------------------------------- */
  if (!loadedImage) {
    return (
      <div style={S.wrapper}>
        {/* Toolbar (minimal) */}
        <div style={S.toolbar}>
          <span style={{ color: 'var(--text-primary, #e6edf3)', fontSize: 14, fontWeight: 600 }}>
            Map / Schematic
          </span>
        </div>

        {/* Drop zone */}
        <div
          style={{ ...S.dropZone, ...(dropActive ? S.dropActive : {}) }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileRef.current?.click()}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, opacity: 0.5 }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary, #e6edf3)' }}>
            Drop a map image here
          </span>
          <span style={{ fontSize: 14 }}>or click to browse (PNG, JPG)</span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          style={{ display: 'none' }}
          onChange={onFilePick}
        />
      </div>
    );
  }

  /* ---- render: image loaded, full annotation UI ------------------- */
  return (
    <div style={S.wrapper}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <span style={{ color: 'var(--text-primary, #e6edf3)', fontSize: 14, fontWeight: 600, marginRight: 8 }}>
          Map / Schematic
        </span>

        {/* Tool buttons */}
        <button style={S.btn(tool === 'select')} onClick={() => setTool('select')} title="Select / Pan">
          Select
        </button>
        <button style={S.btn(tool === 'circle')} onClick={() => setTool('circle')} title="Draw ellipse — drag from one end of the pipe segment to the other">
          Circle
        </button>
        <button style={S.btn(tool === 'text')} onClick={() => setTool('text')} title="Add text label">
          Text
        </button>

        <div style={S.separator} />

        {/* Color presets */}
        <span style={S.label}>Color</span>
        {PRESET_COLORS.map((c) => (
          <div
            key={c.value}
            style={S.colorSwatch(c.value, activeColor === c.value)}
            title={c.label}
            onClick={() => setActiveColor(c.value)}
          />
        ))}

        <div style={S.separator} />

        {/* Stroke width */}
        <span style={S.label}>Width</span>
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            style={S.btn(activeStroke === w)}
            onClick={() => setActiveStroke(w)}
          >
            {w}px
          </button>
        ))}

        <div style={S.separator} />

        {/* Undo / Redo */}
        <button
          style={S.btn(false)}
          onClick={undo}
          disabled={undoStack.length === 0}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          style={S.btn(false)}
          onClick={redo}
          disabled={redoStack.length === 0}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>

        <div style={S.separator} />

        {/* Replace image */}
        <button
          style={S.btn(false)}
          onClick={() => fileRef.current?.click()}
          title="Replace map image"
        >
          Replace Image
        </button>
      </div>

      {/* Contextual edit toolbar: appears only when an ellipse is selected */}
      {selectedEllipse && (
        <div style={{ ...S.toolbar, background: 'rgba(47,129,247,0.08)' }}>
          <span style={{ color: 'var(--text-primary, #e6edf3)', fontSize: 14, fontWeight: 600, marginRight: 8 }}>
            Edit circle
          </span>

          <span style={S.label}>Size</span>
          <button style={S.btn(false)} onClick={() => scaleAxis('x', 1.15)} title="Stretch along the pipe direction">Longer</button>
          <button style={S.btn(false)} onClick={() => scaleAxis('x', 1 / 1.15)} title="Shrink along the pipe direction">Shorter</button>
          <button style={S.btn(false)} onClick={() => scaleAxis('y', 1.15)} title="Increase thickness across the pipe">Fatter</button>
          <button style={S.btn(false)} onClick={() => scaleAxis('y', 1 / 1.15)} title="Decrease thickness across the pipe">Thinner</button>

          <div style={S.separator} />

          <span style={S.label}>Rotate</span>
          <button style={S.btn(false)} onClick={() => rotateSelected(-15)} title="Rotate 15° counter-clockwise">Rotate −15°</button>
          <button style={S.btn(false)} onClick={() => rotateSelected(15)} title="Rotate 15° clockwise">Rotate +15°</button>
          <button style={S.btn(false)} onClick={() => rotateSelected(90)} title="Rotate 90°">Rotate 90°</button>

          <div style={S.separator} />

          <button
            style={{ ...S.btn(false), color: '#ff6b6b', borderColor: '#ff6b6b' }}
            onClick={deleteSelected}
            title="Delete this circle"
          >
            Delete
          </button>

          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary, #8b949e)', fontSize: 12 }}>
            Drag to move · click outside to deselect
          </span>
        </div>
      )}

      {/* Canvas area */}
      <div
        ref={containerRef}
        style={{ ...S.canvasWrap, cursor }}
        onMouseDown={onPanStart}
        onMouseMove={onPanMove}
        onMouseUp={onPanEnd}
        onMouseLeave={onPanEnd}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          scaleX={scale}
          scaleY={scale}
          x={position.x}
          y={position.y}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={onStageMouseUp}
          onWheel={onWheel}
        >
          <Layer>
            {/* Background image */}
            <KImage image={loadedImage} />

            {/* Committed annotations */}
            {annotations.map((ann) => {
              const isSelected = selectedId === ann.id;

              if (ann.type === 'circle') {
                return (
                  <Ellipse
                    key={ann.id}
                    x={ann.x}
                    y={ann.y}
                    radiusX={ann.radiusX ?? 20}
                    radiusY={ann.radiusY ?? 20}
                    rotation={ann.rotation ?? 0}
                    stroke={ann.stroke ?? activeColor}
                    strokeWidth={ann.strokeWidth ?? 3}
                    // Near-invisible fill so the whole interior is clickable.
                    // Pure 'transparent' makes Konva treat the shape as
                    // hollow, so clicks inside the ellipse fall through to
                    // the map image and the selection is cleared instead.
                    fill="rgba(0,0,0,0.001)"
                    draggable={tool === 'select'}
                    onClick={() => onAnnotationClick(ann.id)}
                    onTap={() => onAnnotationClick(ann.id)}
                    onDragEnd={(e) =>
                      onAnnotationDragEnd(ann.id, e.target.x(), e.target.y())
                    }
                    shadowColor={isSelected ? 'var(--accent, #2f81f7)' : undefined}
                    shadowBlur={isSelected ? 8 : 0}
                    shadowEnabled={isSelected}
                    hitStrokeWidth={12}
                  />
                );
              }

              if (ann.type === 'text') {
                return (
                  <KText
                    key={ann.id}
                    x={ann.x}
                    y={ann.y}
                    text={ann.text ?? ''}
                    fontSize={ann.fontSize ?? 16}
                    fill={ann.fill ?? activeColor}
                    fontFamily="Arial"
                    fontStyle="bold"
                    draggable={tool === 'select'}
                    onClick={() => onAnnotationClick(ann.id)}
                    onTap={() => onAnnotationClick(ann.id)}
                    onDragEnd={(e) =>
                      onAnnotationDragEnd(ann.id, e.target.x(), e.target.y())
                    }
                    shadowColor={isSelected ? 'var(--accent, #2f81f7)' : undefined}
                    shadowBlur={isSelected ? 8 : 0}
                    shadowEnabled={isSelected}
                  />
                );
              }
              return null;
            })}

            {/* Draw preview (while dragging ellipse)
             *
             * Always render — toggle via `visible` — so react-konva keeps the
             * same Konva node across mousemove re-renders instead of
             * un/re-mounting it. Conditional `{drawPreview && <Ellipse ...>}`
             * caused the preview to pop off/on during drag because the node
             * was being destroyed and recreated on every frame change.
             *
             * perfectDrawEnabled=false + shadowForStrokeEnabled=false skip
             * Konva's hi-fi dual-pass redraw, which is overkill for a dashed
             * preview and measurably smoother at 60Hz.
             */}
            <Ellipse
              visible={!!drawPreview}
              x={drawPreview?.x ?? 0}
              y={drawPreview?.y ?? 0}
              radiusX={drawPreview?.radiusX ?? 0}
              radiusY={drawPreview?.radiusY ?? 0}
              rotation={drawPreview?.rotation ?? 0}
              stroke={drawPreview?.stroke ?? activeColor}
              strokeWidth={drawPreview?.strokeWidth ?? 3}
              fill="transparent"
              dash={[6, 3]}
              listening={false}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />
          </Layer>
        </Stage>

        {/* Inline text input overlay */}
        {textInput && (
          <input
            autoFocus
            style={{
              ...S.textInput,
              left: textInput.x,
              top: textInput.y,
            }}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitText();
              if (e.key === 'Escape') {
                setTextInput(null);
                setTextValue('');
              }
            }}
            onBlur={commitText}
            placeholder="Label..."
          />
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg"
        style={{ display: 'none' }}
        onChange={onFilePick}
      />

      {/* Status bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 12px',
          borderTop: '1px solid var(--border, #30363d)',
          fontSize: 14,
          color: 'var(--text-secondary, #8b949e)',
        }}
      >
        <span>
          {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
          {selectedId ? ' \u00B7 Selected (Del to remove)' : ''}
        </span>
        <span>
          Zoom: {Math.round(scale * 100)}%
          {' \u00B7 '}
          Scroll to zoom \u00B7 {tool === 'select' ? 'Drag to pan' : ''}
        </span>
      </div>
    </div>
  );
}

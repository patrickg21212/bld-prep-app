import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Tile sources — all free, no API key, no billing.
// We stack three layers for a hybrid aerial view. OSM is dropped in favor of
// a burned-in pin + address label sourced from the search query, because
// OSM's house number tile data is too patchy across most US field areas.
// 1. Esri World Imagery — satellite base.
// 2. Esri World Transportation — street network + major road labels.
// 3. Esri World Boundaries and Places — city/neighborhood/area labels.
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_TRANSPORT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const ESRI_PLACES_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const ESRI_ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const COMBINED_ATTRIBUTION = ESRI_ATTRIBUTION;

// USGS National Map (kept as a constant for quick flip if Esri ever blocks).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const USGS_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const USGS_ATTRIBUTION = 'USGS The National Map: Orthoimagery';

// Overlay opacity. Kept here so capture() matches live rendering exactly.
const TRANSPORT_OPACITY = 0.9;
const PLACES_OPACITY = 0.9;

// Nominatim requires a contact UA + rate limit of 1 req/sec.
// Ref: https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'BLD-Prep-Sheet-App/1.0 (bld-prep-sheet)';
const NOMINATIM_MIN_INTERVAL_MS = 1100;

// Default crop box size (screen pixels). User can resize; the overlay snaps
// to the visible container area.
const DEFAULT_CROP_PX = 420;

interface Props {
  initialAddress?: string;
  onCrop: (croppedDataUrl: string) => void;
  onClose: () => void;
}

interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GeoResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    house_number?: string;
    road?: string;
    [key: string]: string | undefined;
  };
}

interface PinState {
  lat: number;
  lon: number;
  label: string;
}

// Compute the short, pin-friendly label from a Nominatim result and the
// original user query. Preference order:
//   1. "<house_number> <road>" when Nominatim returns structured address fields
//   2. Original user query if it looks like a street address
//   3. First comma-separated segment of display_name
// Output is trimmed and capped at 80 chars so it always fits the canvas label.
function labelFromGeocode(result: GeoResult, query: string): string {
  const hn = result.address?.house_number?.trim();
  const road = result.address?.road?.trim();
  if (hn && road) return `${hn} ${road}`.slice(0, 80);
  const qFirst = query.split(',')[0]?.trim();
  if (qFirst && /\d/.test(qFirst)) return qFirst.slice(0, 80);
  const dnFirst = result.display_name.split(',')[0]?.trim();
  if (dnFirst) return dnFirst.slice(0, 80);
  return query.trim().slice(0, 80);
}

export default function MapViewer({ initialAddress, onCrop, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const transportLayerRef = useRef<L.TileLayer | null>(null);
  const placesLayerRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const lastGeocodeAtRef = useRef<number>(0);
  // Mirror of `pin` state so the marker's dragend handler (registered once)
  // can update the latest label without stale-closure issues.
  const pinRef = useRef<PinState | null>(null);

  const [address, setAddress] = useState(initialAddress ?? '');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [pin, setPin] = useState<PinState | null>(null);

  // Initialize the map once the container is mounted.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    // US-centered default view when we don't have an address yet.
    const map = L.map(el, {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: false,
    });

    // Base: Esri World Imagery (satellite).
    const baseLayer = L.tileLayer(ESRI_TILES, {
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: 'anonymous',
    });
    baseLayer.on('tileerror', () => {
      setTileError('Some aerial tiles failed to load. Check your internet connection and try panning.');
    });
    baseLayer.addTo(map);

    // Overlay 1: Esri World Transportation — street network + road labels.
    const transportLayer = L.tileLayer(ESRI_TRANSPORT_TILES, {
      maxZoom: 19,
      crossOrigin: 'anonymous',
      opacity: TRANSPORT_OPACITY,
      pane: 'tilePane',
      zIndex: 2,
    });
    transportLayer.addTo(map);

    // Overlay 2: Esri World Boundaries and Places — city/neighborhood labels.
    const placesLayer = L.tileLayer(ESRI_PLACES_TILES, {
      maxZoom: 19,
      crossOrigin: 'anonymous',
      opacity: PLACES_OPACITY,
      pane: 'tilePane',
      zIndex: 3,
    });
    placesLayer.addTo(map);

    mapRef.current = map;
    tileLayerRef.current = baseLayer;
    transportLayerRef.current = transportLayer;
    placesLayerRef.current = placesLayer;

    // Seed a crop rect centered in the viewport so the user has something to
    // adjust immediately, matching the "click to mark, then confirm" pattern
    // from PlanViewer.
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const size = Math.min(DEFAULT_CROP_PX, rect.width - 40, rect.height - 40);
      setCrop({
        left: (rect.width - size) / 2,
        top: (rect.height - size) / 2,
        width: size,
        height: size,
      });
    });

    // Leaflet needs a size invalidation after the modal opens — the container
    // isn't fully sized on the first layout tick inside a fixed-position dialog.
    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      window.clearTimeout(resizeTimer);
      try { map.remove(); } catch { /* already removed */ }
      mapRef.current = null;
      tileLayerRef.current = null;
      transportLayerRef.current = null;
      placesLayerRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Re-invalidate on window resize so the map fills the dialog correctly.
  useEffect(() => {
    const onResize = () => {
      mapRef.current?.invalidateSize();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const doSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setSearchError('Enter an address first.');
      return;
    }
    // Enforce Nominatim rate limit (1 req/sec).
    const since = Date.now() - lastGeocodeAtRef.current;
    if (since < NOMINATIM_MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS - since));
    }

    setSearching(true);
    setSearchError(null);
    try {
      // `addressdetails=1` gives us house_number + road for a clean short label.
      const url = `${NOMINATIM_URL}?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: {
          // Browsers ignore UA override on fetch (it's a forbidden header),
          // but we include Referer-like context via the query itself.
          // Nominatim identifies us by the origin + query pattern.
          'Accept': 'application/json',
          'Accept-Language': 'en',
          // Setting User-Agent is blocked by browsers; Nominatim accepts the
          // origin header instead. Browsers send Origin automatically.
        },
      });
      if (!res.ok) {
        throw new Error(`Geocoder returned ${res.status}`);
      }
      const results = (await res.json()) as GeoResult[];
      lastGeocodeAtRef.current = Date.now();
      if (!results.length) {
        setSearchError('No result for that address. Try adding city/state.');
        return;
      }
      const first = results[0];
      const lat = parseFloat(first.lat);
      const lon = parseFloat(first.lon);
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        setSearchError('Geocoder returned an unrecognized result.');
        return;
      }
      const label = labelFromGeocode(first, q);
      const next: PinState = { lat, lon, label };
      setPin(next);
      pinRef.current = next;
      const map = mapRef.current;
      if (map) {
        map.setView([lat, lon], 19);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  // Keep ref in sync so the marker dragend handler always reads the latest pin.
  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);

  // Sync the Leaflet marker + permanent tooltip whenever the pin changes.
  // The marker is created lazily on first pin; subsequent pin updates just
  // move it and swap the tooltip content. Drag handler is attached once.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pin) {
      if (markerRef.current) {
        try { markerRef.current.remove(); } catch { /* ignore */ }
        markerRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      // Use a divIcon so we don't have to wrangle Leaflet's default marker
      // asset URLs through Vite/Astro's bundler. SVG drawn inline, anchored
      // at its bottom tip so the tip touches the exact lat/lng.
      const pinSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
          <path d="M14 0 C6.3 0 0 6.3 0 14 C0 24.5 14 40 14 40 S28 24.5 28 14 C28 6.3 21.7 0 14 0 Z"
                fill="#DC2626" stroke="#ffffff" stroke-width="2"/>
          <circle cx="14" cy="14" r="5" fill="#ffffff"/>
        </svg>`;
      const icon = L.divIcon({
        className: 'bld-map-pin',
        html: pinSvg,
        iconSize: [28, 40],
        iconAnchor: [14, 40],
        tooltipAnchor: [14, -20],
      });
      const marker = L.marker([pin.lat, pin.lon], { icon, draggable: true });
      marker.addTo(map);
      marker.bindTooltip(pin.label, {
        permanent: true,
        direction: 'right',
        offset: [10, 0],
        className: 'bld-map-pin-tooltip',
      });
      marker.on('dragend', () => {
        const latlng = marker.getLatLng();
        const current = pinRef.current;
        if (!current) return;
        const next: PinState = {
          lat: latlng.lat,
          lon: latlng.lng,
          label: current.label,
        };
        setPin(next);
        pinRef.current = next;
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([pin.lat, pin.lon]);
      const tooltip = markerRef.current.getTooltip();
      if (tooltip) tooltip.setContent(pin.label);
    }
  }, [pin]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(address);
  };

  // Fetch a single tile as an Image (cross-origin) and resolve once loaded.
  // Template is a {z}/{x}/{y} URL — same format Leaflet uses internally.
  const fetchTile = (template: string, z: number, x: number, y: number): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const url = template
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Tile fetch failed: ${template} z=${z} x=${x} y=${y}`));
      img.src = url;
    });
  };

  // Render the current crop by refetching tiles ourselves (clean PNG, no CSS
  // transform artifacts). We use Leaflet to map container pixels -> lat/lng
  // -> projected pixel coordinates at the current integer zoom, then figure
  // out which tile grid cells cover the crop bbox and paint them to a canvas.
  const handleCapture = useCallback(async () => {
    const map = mapRef.current;
    const containerEl = containerRef.current;
    if (!map || !containerEl || !crop) return;

    setCapturing(true);
    setTileError(null);
    try {
      const containerRect = containerEl.getBoundingClientRect();
      const z = Math.round(map.getZoom());
      const tileSize = 256;

      // Translate crop corners (relative to the map container) into
      // Leaflet layer-point coordinates. containerPointToLayerPoint does
      // exactly that.
      const topLeftLayer = map.containerPointToLayerPoint([crop.left, crop.top]);
      const bottomRightLayer = map.containerPointToLayerPoint([
        crop.left + crop.width,
        crop.top + crop.height,
      ]);
      const topLeftLatLng = map.layerPointToLatLng(topLeftLayer);
      const bottomRightLatLng = map.layerPointToLatLng(bottomRightLayer);

      // Project to world pixel space at zoom z.
      const nwPx = map.project(topLeftLatLng, z);
      const sePx = map.project(bottomRightLatLng, z);

      const minPxX = Math.min(nwPx.x, sePx.x);
      const maxPxX = Math.max(nwPx.x, sePx.x);
      const minPxY = Math.min(nwPx.y, sePx.y);
      const maxPxY = Math.max(nwPx.y, sePx.y);

      const minTileX = Math.floor(minPxX / tileSize);
      const maxTileX = Math.floor(maxPxX / tileSize);
      const minTileY = Math.floor(minPxY / tileSize);
      const maxTileY = Math.floor(maxPxY / tileSize);

      // Safety cap so a bad crop can't try to fetch thousands of tiles.
      // 200 tiles per layer × 3 layers = 600 requests max. Esri handles that
      // comfortably for a one-off capture.
      const tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
      if (tileCount > 200) {
        throw new Error('Crop too large for current zoom. Zoom in or shrink the box.');
      }

      // Full grid canvas covering all tiles we need.
      const gridWidth = (maxTileX - minTileX + 1) * tileSize;
      const gridHeight = (maxTileY - minTileY + 1) * tileSize;
      const gridCanvas = document.createElement('canvas');
      gridCanvas.width = gridWidth;
      gridCanvas.height = gridHeight;
      const gridCtx = gridCanvas.getContext('2d')!;
      gridCtx.fillStyle = '#1a1a1a';
      gridCtx.fillRect(0, 0, gridWidth, gridHeight);

      // Helper: paint one layer across the whole tile grid.
      // A missing tile from any layer is logged and skipped — the layer below
      // stays visible underneath, which is exactly what we want.
      const paintLayer = async (
        template: string,
        opts: { alpha: number; composite: GlobalCompositeOperation },
      ) => {
        const jobs: Promise<void>[] = [];
        for (let tx = minTileX; tx <= maxTileX; tx++) {
          for (let ty = minTileY; ty <= maxTileY; ty++) {
            const destX = (tx - minTileX) * tileSize;
            const destY = (ty - minTileY) * tileSize;
            jobs.push(
              fetchTile(template, z, tx, ty).then(img => {
                gridCtx.save();
                gridCtx.globalAlpha = opts.alpha;
                gridCtx.globalCompositeOperation = opts.composite;
                gridCtx.drawImage(img, destX, destY);
                gridCtx.restore();
              }).catch(err => {
                console.warn('Tile fetch failed', err);
                // Base layer: paint a placeholder so the gap is visible.
                // Overlay layers: skip silently — the base shows through.
                if (template === ESRI_TILES) {
                  gridCtx.save();
                  gridCtx.globalAlpha = 1;
                  gridCtx.globalCompositeOperation = 'source-over';
                  gridCtx.fillStyle = '#333';
                  gridCtx.fillRect(destX, destY, tileSize, tileSize);
                  gridCtx.restore();
                }
              }),
            );
          }
        }
        await Promise.all(jobs);
      };

      // 1. Satellite base (solid).
      await paintLayer(ESRI_TILES, { alpha: 1, composite: 'source-over' });
      // 2. Transportation (streets + road labels).
      await paintLayer(ESRI_TRANSPORT_TILES, { alpha: TRANSPORT_OPACITY, composite: 'source-over' });
      // 3. Places (city/neighborhood labels).
      await paintLayer(ESRI_PLACES_TILES, { alpha: PLACES_OPACITY, composite: 'source-over' });
      gridCtx.globalCompositeOperation = 'source-over';
      gridCtx.globalAlpha = 1;

      // Crop the exact area we want out of the grid canvas.
      const cropCanvas = document.createElement('canvas');
      const outWidth = Math.round(maxPxX - minPxX);
      const outHeight = Math.round(maxPxY - minPxY);
      if (outWidth < 10 || outHeight < 10) {
        throw new Error('Crop area is too small.');
      }
      cropCanvas.width = outWidth;
      cropCanvas.height = outHeight;
      const cropCtx = cropCanvas.getContext('2d')!;
      const sourceX = minPxX - minTileX * tileSize;
      const sourceY = minPxY - minTileY * tileSize;
      cropCtx.drawImage(
        gridCanvas,
        sourceX, sourceY, outWidth, outHeight,
        0, 0, outWidth, outHeight,
      );

      // Burn the address pin + label into the crop if the pinned lat/lng
      // falls inside the visible area. Skips cleanly if the user panned the
      // pin off-screen before cropping. Drawn here (on cropCtx, after the
      // cropCanvas.drawImage) so the pin is in final-output pixel space.
      if (pin) {
        const pinWorld = map.project([pin.lat, pin.lon], z);
        const pinX = pinWorld.x - minPxX;
        const pinY = pinWorld.y - minPxY;
        if (pinX >= 0 && pinX <= outWidth && pinY >= 0 && pinY <= outHeight) {
          drawPinAndLabel(cropCtx, pinX, pinY, pin.label, outWidth, outHeight);
        }
      }

      // Burn the Esri attribution into the bottom-right corner so the output
      // carries credit even after it's saved into the PDF.
      const attrText = COMBINED_ATTRIBUTION;
      cropCtx.font = '10px system-ui, sans-serif';
      const padding = 4;
      const metrics = cropCtx.measureText(attrText);
      const textW = metrics.width + padding * 2;
      const textH = 14;
      cropCtx.fillStyle = 'rgba(0,0,0,0.55)';
      cropCtx.fillRect(outWidth - textW, outHeight - textH, textW, textH);
      cropCtx.fillStyle = '#fff';
      cropCtx.textBaseline = 'middle';
      cropCtx.fillText(attrText, outWidth - textW + padding, outHeight - textH / 2);

      const dataUrl = cropCanvas.toDataURL('image/png');
      onCrop(dataUrl);
    } catch (e) {
      setTileError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }, [crop, onCrop, pin]);

  // Crop box dragging/resizing ------------------------------------------------
  // Simple: drag body to move, drag corner handles to resize. Kept small on
  // purpose — no dependency on a DnD library.
  const dragStateRef = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;
    startX: number;
    startY: number;
    startRect: CropRect;
  }>({ mode: null, startX: 0, startY: 0, startRect: { left: 0, top: 0, width: 0, height: 0 } });

  const beginCropDrag = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') =>
    (e: React.PointerEvent) => {
      if (!crop) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragStateRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...crop },
      };
    };

  const moveCropDrag = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s.mode) return;
    const containerEl = containerRef.current;
    if (!containerEl) return;
    e.stopPropagation();
    e.preventDefault();
    const bounds = containerEl.getBoundingClientRect();
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const r = { ...s.startRect };
    const MIN = 60;

    if (s.mode === 'move') {
      r.left = Math.max(0, Math.min(bounds.width - r.width, s.startRect.left + dx));
      r.top = Math.max(0, Math.min(bounds.height - r.height, s.startRect.top + dy));
    } else {
      // Corner resize — anchor opposite corner.
      if (s.mode === 'nw') {
        const right = s.startRect.left + s.startRect.width;
        const bottom = s.startRect.top + s.startRect.height;
        const newLeft = Math.max(0, Math.min(right - MIN, s.startRect.left + dx));
        const newTop = Math.max(0, Math.min(bottom - MIN, s.startRect.top + dy));
        r.left = newLeft;
        r.top = newTop;
        r.width = right - newLeft;
        r.height = bottom - newTop;
      } else if (s.mode === 'ne') {
        const bottom = s.startRect.top + s.startRect.height;
        const newTop = Math.max(0, Math.min(bottom - MIN, s.startRect.top + dy));
        const newWidth = Math.max(MIN, Math.min(bounds.width - s.startRect.left, s.startRect.width + dx));
        r.top = newTop;
        r.width = newWidth;
        r.height = bottom - newTop;
      } else if (s.mode === 'sw') {
        const right = s.startRect.left + s.startRect.width;
        const newLeft = Math.max(0, Math.min(right - MIN, s.startRect.left + dx));
        const newHeight = Math.max(MIN, Math.min(bounds.height - s.startRect.top, s.startRect.height + dy));
        r.left = newLeft;
        r.width = right - newLeft;
        r.height = newHeight;
      } else if (s.mode === 'se') {
        const newWidth = Math.max(MIN, Math.min(bounds.width - s.startRect.left, s.startRect.width + dx));
        const newHeight = Math.max(MIN, Math.min(bounds.height - s.startRect.top, s.startRect.height + dy));
        r.width = newWidth;
        r.height = newHeight;
      }
    }
    setCrop(r);
  };

  const endCropDrag = (e: React.PointerEvent) => {
    if (!dragStateRef.current.mode) return;
    dragStateRef.current.mode = null;
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Toolbar — mirrors PlanViewer's visual language */}
      <div style={{
        background: 'var(--nav-bg)', padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button onClick={onClose} style={toolBtnStyle}>&times; Close</button>

        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Address, city, or intersection"
            style={{
              width: 320, background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4,
              color: 'white', fontSize: 14, padding: '5px 10px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={searching}
            style={{
              ...toolBtnStyle,
              background: searching ? 'rgba(47,129,247,0.2)' : 'rgba(47,129,247,0.3)',
              borderColor: '#2f81f7',
              color: 'white',
              opacity: searching ? 0.7 : 1,
            }}
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {searchError && (
          <span style={{ color: '#f97171', fontSize: 13 }}>{searchError}</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={handleCapture}
            disabled={capturing || !crop}
            style={{
              background: capturing ? 'rgba(47,129,247,0.4)' : '#2f81f7',
              border: 'none', color: 'white',
              borderRadius: 4, padding: '6px 16px', fontSize: 14, fontWeight: 600,
              cursor: capturing ? 'wait' : 'pointer',
              opacity: capturing || !crop ? 0.7 : 1,
            }}
          >
            {capturing ? 'Capturing...' : 'Capture this view'}
          </button>
        </div>
      </div>

      {tileError && (
        <div style={{
          background: 'rgba(249,113,113,0.12)',
          borderBottom: '1px solid #f97171',
          padding: '6px 16px', color: '#f97171', fontSize: 13,
          flexShrink: 0,
        }}>
          {tileError}
        </div>
      )}

      {/* Map container */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          ref={containerRef}
          style={{ position: 'absolute', inset: 0, background: '#111' }}
        />

        {/* Crop overlay — drawn over the live Leaflet map. Pointer events are
            only active on the rectangle itself, so the rest of the map stays
            pannable/zoomable. */}
        {crop && (
          <div
            onPointerMove={moveCropDrag}
            onPointerUp={endCropDrag}
            onPointerCancel={endCropDrag}
            style={{
              position: 'absolute',
              left: crop.left, top: crop.top,
              width: crop.width, height: crop.height,
              border: '3px solid #2f81f7',
              background: 'rgba(47,129,247,0.08)',
              borderRadius: 4,
              cursor: 'move',
              zIndex: 500,
              boxShadow: '0 0 0 99999px rgba(0,0,0,0.25)',
            }}
            onPointerDown={beginCropDrag('move')}
          >
            <div style={{
              position: 'absolute', top: -26, left: '50%', transform: 'translateX(-50%)',
              background: '#2f81f7',
              color: 'white', fontSize: 12, fontWeight: 600,
              padding: '2px 8px', borderRadius: 3, whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}>
              Drag to reposition &middot; grab corners to resize &middot; then "Capture this view"
            </div>
            {/* Corner handles */}
            <Handle pos="nw" onPointerDown={beginCropDrag('nw')} />
            <Handle pos="ne" onPointerDown={beginCropDrag('ne')} />
            <Handle pos="sw" onPointerDown={beginCropDrag('sw')} />
            <Handle pos="se" onPointerDown={beginCropDrag('se')} />
          </div>
        )}
      </div>
    </div>
  );
}

function Handle({ pos, onPointerDown }: {
  pos: 'nw' | 'ne' | 'sw' | 'se';
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const size = 14;
  const offset = -size / 2;
  const style: React.CSSProperties = {
    position: 'absolute',
    width: size, height: size,
    background: '#fff',
    border: '2px solid #2f81f7',
    borderRadius: 3,
    zIndex: 2,
  };
  if (pos === 'nw') { style.left = offset; style.top = offset; style.cursor = 'nwse-resize'; }
  if (pos === 'ne') { style.right = offset; style.top = offset; style.cursor = 'nesw-resize'; }
  if (pos === 'sw') { style.left = offset; style.bottom = offset; style.cursor = 'nesw-resize'; }
  if (pos === 'se') { style.right = offset; style.bottom = offset; style.cursor = 'nwse-resize'; }
  return <div style={style} onPointerDown={onPointerDown} />;
}

// Draws a red map-pin icon + address label on the captured crop at the
// given pixel coordinates. The pin's tip points exactly at (x, y) so the
// lat/lng reference is preserved. The label renders to the right of the pin
// with a halo (white stroke behind black fill) for legibility against any
// satellite background — no opaque background box that would cover roofs.
// Wraps the label onto a second line if a single line exceeds ~40% of the
// output width, and truncates with ellipsis if it would still overflow.
function drawPinAndLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  outWidth: number,
  outHeight: number,
) {
  ctx.save();

  // Pin geometry — matches the live divIcon above for consistency. Tip at
  // (x, y); body is 28w x 40h.
  const pinW = 28;
  const pinH = 40;
  const headR = 9;
  const headCx = x;
  const headCy = y - pinH + headR + 5;

  // Teardrop body.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + pinW / 2, y - pinH * 0.55, headCx + headR, headCy);
  ctx.arc(headCx, headCy, headR, 0, Math.PI, true);
  ctx.quadraticCurveTo(x - pinW / 2, y - pinH * 0.55, x, y);
  ctx.closePath();
  ctx.fillStyle = '#DC2626';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  // White inner dot.
  ctx.beginPath();
  ctx.arc(headCx, headCy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Label rendering -----------------------------------------------------
  ctx.font = 'bold 15px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const labelX = headCx + headR + 6;
  const labelYCenter = headCy;

  // Wrap onto 2 lines max. First line breaks at the last space that fits
  // within maxLineW; remainder goes to line 2, truncated with ellipsis
  // if still too long.
  const maxLineW = Math.max(80, outWidth * 0.45);
  const lines = wrapLabel(ctx, label, maxLineW, 2);

  // Clamp label X so it doesn't run off the right edge at small crops —
  // flip to the left of the pin if there's not enough room on the right.
  const longestLine = lines.reduce(
    (w, ln) => Math.max(w, ctx.measureText(ln).width),
    0,
  );
  let drawX = labelX;
  if (drawX + longestLine > outWidth - 6) {
    const leftX = headCx - headR - 6 - longestLine;
    if (leftX >= 6) {
      drawX = leftX;
    }
  }

  const lineHeight = 18;
  const startY = labelYCenter - ((lines.length - 1) * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    const ty = startY + i * lineHeight;
    // White halo for contrast against any satellite imagery.
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(lines[i], drawX, ty);
    ctx.fillStyle = '#000000';
    ctx.fillText(lines[i], drawX, ty);
  }

  // outHeight is referenced only to signal intent (caller guarantees y is
  // within bounds). Silence unused-var linting without changing signature.
  void outHeight;

  ctx.restore();
}

// Greedy word-wrap onto up to `maxLines` lines of width <= maxW. The last
// line is truncated with an ellipsis if remaining text still overflows.
function wrapLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxW) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
    } else {
      // Single word longer than maxW — just push it; final truncation
      // pass below handles it.
      lines.push(word);
      current = '';
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // If we still have words left over, append ellipsis to the final line.
  const joined = lines.join(' ');
  if (joined.length < text.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxW) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + '…';
  }
  return lines;
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

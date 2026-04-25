// PDF generation engine for BLD Services CIPP liner prep sheets
// Uses jsPDF to programmatically draw the prep sheet matching the 2026
// BLD Mainline Prep template:
//   - Top header: OPERATOR | READY TO LINE | DATE | JOB # | REPAIR # | JOB NAME
//   - USMH / DSMH (not FROM/TO)
//   - USMH DEPTH / DSMH DEPTH
//   - M/H LOCATIONS: STREET / EASEMENT
//   - PIPE MATERIAL field
//   - BLOWN TOILETS (no pink highlight)
//   - TRAFFIC and HYDRANT LOCATION removed
//   - 5 fixed ruled COMMENTS lines at bottom
//   - Sketch area ~60% of page, North arrow top-left

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import type { Segment, SegmentObservations, SegmentFieldKey } from './types';
import { BLD_LOGO_BASE64 } from './bld-logo-data';

export interface PdfInput {
  segment: Segment;
  observations: SegmentObservations;
  jobNumber: string;
  jobName: string;
  operator: string;
  mapImageDataUrl?: string;
}

// ── Page constants (letter size in mm) ──────────────────────────────────────
const PAGE_W = 215.9; // 8.5 inches
const PAGE_H = 279.4; // 11 inches
const MARGIN_L = 14;
const MARGIN_R = 14;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

// Colors
const BLACK = '#000000';
const DARK_GRAY = '#333333';
const UNDERLINE_COLOR = '#000000';

// Font sizes
const FONT_LABEL = 10;
const FONT_VALUE = 10;
const FONT_SMALL = 8;

// Row spacing
const ROW_GAP = 10;

// Fixed ruled-line count for the COMMENTS section at the bottom of the page.
const COMMENT_LINE_COUNT = 5;
const COMMENT_LINE_MM = 6;
const COMMENT_INDENT_MM = 26;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Draw a field label (bold) followed by an underlined value area.
 * The underline runs from the end of the label to x + fieldWidth.
 */
function drawField(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  fieldWidth: number,
): void {
  // Label (bold)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  doc.setTextColor(BLACK);
  doc.text(label, x, y);

  const labelW = doc.getTextWidth(label);

  // Value (normal weight)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_VALUE);
  doc.setTextColor(DARK_GRAY);
  const valueX = x + labelW + 1;
  doc.text(value || '', valueX + 1, y);

  // Underline from end of label to fieldWidth boundary
  doc.setDrawColor(UNDERLINE_COLOR);
  doc.setLineWidth(0.3);
  const lineStart = x + labelW;
  const lineEnd = x + fieldWidth;
  doc.line(lineStart, y + 1.5, lineEnd, y + 1.5);
}

/**
 * Draw a toggle group as plain text: "LABEL: OPT1 / OPT2 / OPT3"
 * Selected option is bold + underlined. Unselected options are normal weight.
 */
function drawToggleText(
  doc: jsPDF,
  label: string,
  options: string[],
  selected: string | boolean | null,
  x: number,
  y: number,
): number {
  // Label (bold)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  doc.setTextColor(BLACK);
  doc.text(label, x, y);

  let currentX = x + doc.getTextWidth(label) + 2;

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const isSelected =
      typeof selected === 'boolean'
        ? (opt === 'YES' && selected === true) || (opt === 'NO' && selected === false)
        : selected === opt;

    if (isSelected) {
      // Bold + underline for selected
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_LABEL);
      doc.setTextColor(BLACK);
      doc.text(opt, currentX, y);
      const optW = doc.getTextWidth(opt);
      // Draw underline under the selected text
      doc.setDrawColor(BLACK);
      doc.setLineWidth(0.4);
      doc.line(currentX, y + 1.5, currentX + optW, y + 1.5);
      currentX += optW;
    } else {
      // Normal weight for unselected
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_LABEL);
      doc.setTextColor(BLACK);
      doc.text(opt, currentX, y);
      currentX += doc.getTextWidth(opt);
    }

    // Add " / " separator between options (not after last)
    if (i < options.length - 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_LABEL);
      doc.text(' / ', currentX, y);
      currentX += doc.getTextWidth(' / ');
    }
  }

  return currentX;
}

/**
 * Draw a YES / NO inline toggle (plain text style, no circles).
 * Returns the X position after the toggle for chaining.
 */
function drawYesNoText(
  doc: jsPDF,
  label: string,
  value: boolean | null,
  x: number,
  y: number,
): number {
  // Label (bold)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  doc.setTextColor(BLACK);
  const labelStr = label ? label + ': ' : '';
  doc.text(labelStr, x, y);

  let currentX = x + doc.getTextWidth(labelStr);

  // YES
  const yesSelected = value === true;
  if (yesSelected) {
    doc.setFont('helvetica', 'bold');
    doc.text('YES', currentX, y);
    const w = doc.getTextWidth('YES');
    doc.setDrawColor(BLACK);
    doc.setLineWidth(0.4);
    doc.line(currentX, y + 1.5, currentX + w, y + 1.5);
    currentX += w;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.text('YES', currentX, y);
    currentX += doc.getTextWidth('YES');
  }

  // Separator
  doc.setFont('helvetica', 'normal');
  doc.text(' / ', currentX, y);
  currentX += doc.getTextWidth(' / ');

  // NO
  const noSelected = value === false;
  if (noSelected) {
    doc.setFont('helvetica', 'bold');
    doc.text('NO', currentX, y);
    const w = doc.getTextWidth('NO');
    doc.setDrawColor(BLACK);
    doc.setLineWidth(0.4);
    doc.line(currentX, y + 1.5, currentX + w, y + 1.5);
    currentX += w;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.text('NO', currentX, y);
    currentX += doc.getTextWidth('NO');
  }

  return currentX;
}

/** Draw a thick horizontal divider line. */
function drawDivider(doc: jsPDF, y: number): void {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.0);
  doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
}

/**
 * Draw the north arrow: a large blue filled arrow pointing up,
 * with "N O R T H" written vertically INSIDE the arrow shaft.
 * The arrow has a filled blue triangular head at the top.
 */
function drawNorthArrow(doc: jsPDF, cx: number, cy: number, size: number): void {
  const blue: [number, number, number] = [41, 98, 203];

  // Arrow dimensions
  const shaftWidth = size * 0.55;
  const headHeight = size * 0.6;
  const headWidth = size * 0.9;
  const shaftHeight = size * 1.4;
  const totalHeight = headHeight + shaftHeight;

  const arrowTop = cy - totalHeight / 2;
  const headBottom = arrowTop + headHeight;

  // Draw the filled arrow head (triangle)
  doc.setFillColor(blue[0], blue[1], blue[2]);
  doc.setDrawColor(blue[0], blue[1], blue[2]);
  doc.setLineWidth(0.5);

  // Triangle: top point, bottom-left, bottom-right
  doc.triangle(
    cx, arrowTop,
    cx - headWidth / 2, headBottom,
    cx + headWidth / 2, headBottom,
    'F',
  );

  // Draw the filled shaft (rectangle)
  doc.rect(
    cx - shaftWidth / 2,
    headBottom,
    shaftWidth,
    shaftHeight,
    'F',
  );

  // "N O R T H" text vertically INSIDE the shaft
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255); // White text inside blue arrow
  const letters = ['N', 'O', 'R', 'T', 'H'];
  const letterSpacing = shaftHeight / (letters.length + 0.5);
  const startTextY = headBottom + letterSpacing * 0.6;

  for (let i = 0; i < letters.length; i++) {
    doc.text(letters[i], cx, startTextY + i * letterSpacing, { align: 'center' });
  }
}

/** Format date for display. */
function formatDate(segment: Segment): string {
  if (segment.dateStr) return segment.dateStr;
  if (segment.date) {
    return segment.date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  }
  return '';
}

// ── Core rendering function (draws one page onto a jsPDF doc) ───────────────
function renderPage(doc: jsPDF, input: PdfInput): void {
  const { segment: rawSegment, observations, jobNumber, jobName, operator, mapImageDataUrl } = input;

  // Apply per-segment field overrides from observations so any manual edits
  // the worker made on the prep sheet show up on the exported PDF.
  const ov = (observations.fieldOverrides ?? {}) as Partial<Record<SegmentFieldKey, string>>;
  const pick = (key: SegmentFieldKey, fallback: string): string =>
    ov[key] !== undefined ? (ov[key] as string) : fallback;

  const segment: Segment = {
    ...rawSegment,
    dateStr: pick('dateStr', rawSegment.dateStr),
    repairNumber: pick('repairNumber', rawSegment.repairNumber),
    pipeSize: pick('pipeSize', rawSegment.pipeSize),
    pipeLength: pick('pipeLength', rawSegment.pipeLength),
    pipeMaterial: pick('pipeMaterial', rawSegment.pipeMaterial),
    streetName: pick('streetName', rawSegment.streetName),
    usDepth: pick('usDepth', rawSegment.usDepth),
    dsDepth: pick('dsDepth', rawSegment.dsDepth),
    mhFrom: pick('mhFrom', rawSegment.mhFrom),
    mhTo: pick('mhTo', rawSegment.mhTo),
    sheetNumber: pick('sheetNumber', rawSegment.sheetNumber),
    comments: pick('comments', rawSegment.comments),
  };

  let y = 10;

  // ── LOGO ────────────────────────────────────────────────────────────────
  // Centered logo image. Original aspect ratio ~600x163, scale to fit ~60mm wide.
  const logoW = 60;
  const logoH = 16.3; // maintain aspect ratio
  const logoX = (PAGE_W - logoW) / 2;
  try {
    doc.addImage(BLD_LOGO_BASE64, 'PNG', logoX, y, logoW, logoH);
  } catch {
    // Fallback: text-based logo if image fails
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(BLACK);
    doc.text('BLD SERVICES, LLC', PAGE_W / 2, y + 10, { align: 'center' });
  }

  y += logoH + 8;

  // ── ROW 1 (NEW): OPERATOR:___   READY TO LINE: YES / NO ─────────────────
  const r1Y = y;
  const leftX = MARGIN_L;

  drawField(doc, 'OPERATOR:', operator, leftX, r1Y, CONTENT_W * 0.55);
  drawYesNoText(doc, 'READY TO LINE', observations.readyToLine, leftX + CONTENT_W * 0.6, r1Y);

  y += ROW_GAP;

  // ── ROW 2: DATE | JOB # | JOB NAME | REPAIR # ──────────────────────────
  // Reference-form order: DATE → JOB# → JOB NAME → REPAIR #.
  const r2Y = y;
  drawField(doc, 'DATE:', formatDate(segment), leftX, r2Y, 34);
  drawField(doc, 'JOB #:', jobNumber, leftX + 36, r2Y, 40);
  drawField(doc, 'JOB NAME:', jobName, leftX + 78, r2Y, 70);
  drawField(doc, 'REPAIR #:', segment.repairNumber, leftX + 150, r2Y, CONTENT_W - 150);

  y += ROW_GAP;

  // Thin line under header rows
  doc.setDrawColor(UNDERLINE_COLOR);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_L, y - 2, PAGE_W - MARGIN_R, y - 2);

  y += 2;

  // ── Layout: left column and right column ────────────────────────────────
  const halfW = CONTENT_W / 2;
  const rightCol = MARGIN_L + halfW + 4;
  const rightFieldW = halfW - 4;

  // ── ROW 3: USMH: ___   DSMH: ___   |   STREET: ___ ──────────────────────
  const mhBoxW = halfW / 2 - 2;
  drawField(doc, 'USMH:', segment.mhFrom, leftX, y, mhBoxW);
  drawField(doc, 'DSMH:', segment.mhTo, leftX + mhBoxW + 4, y, mhBoxW);
  drawField(doc, 'STREET:', segment.streetName, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 4: PIPE SIZE | PIPE LENGTH | PIPE MATERIAL ──────────────────────
  const thirdW = CONTENT_W / 3 - 2;
  drawField(doc, 'PIPE SIZE:', segment.pipeSize, leftX, y, thirdW);
  drawField(doc, 'PIPE LENGTH:', segment.pipeLength, leftX + thirdW + 3, y, thirdW);
  drawField(doc, 'PIPE MATERIAL:', segment.pipeMaterial, leftX + 2 * (thirdW + 3), y, thirdW);

  y += ROW_GAP;

  // ── ROW 5: USMH DEPTH | DSMH DEPTH | M/H LOCATIONS: STREET / EASEMENT ──
  const depthFieldW = halfW / 2 - 2;
  drawField(doc, 'USMH DEPTH:', segment.usDepth, leftX, y, depthFieldW);
  drawField(doc, 'DSMH DEPTH:', segment.dsDepth, leftX + depthFieldW + 4, y, depthFieldW);
  drawToggleText(doc, 'M/H LOCATIONS: ', ['STREET', 'EASEMENT'], observations.mhLocation, rightCol, y);

  y += ROW_GAP;

  // ── ROW 6: ADDRESS OF USMH | ADDRESS OF DSMH ────────────────────────────
  drawField(doc, 'ADDRESS OF USMH:', observations.addressUSMH, leftX, y, halfW);
  drawField(doc, 'ADDRESS OF DSMH:', observations.addressDSMH, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 7: OVERHEAD LINES OR TREES: YES / NO  |  INCOMING LINE SIZE ────
  drawYesNoText(doc, 'OVERHEAD LINES OR TREES', observations.overheadLines, leftX, y);
  drawField(doc, 'INCOMING LINE SIZE:', observations.incomingLinesSize, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 8: WATER FLOW | NEEDS POINT REPAIR | INFILTRATION ──────────────
  drawToggleText(doc, 'WATER FLOW: ', ['LIGHT', 'MEDIUM', 'HIGH'], observations.waterFlow, leftX, y);
  drawYesNoText(doc, 'NEEDS POINT REPAIR', observations.needsPointRepair, leftX + 78, y);
  drawYesNoText(doc, 'INFILTRATION', observations.infiltration, leftX + 145, y);

  y += ROW_GAP;

  // ── ROW 10: BLOWN TOILETS: YES/NO (IF YES, LIST ADDRESSES) ───────────────
  // No pink highlight — plain label like the 2026 reference form.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  const blowLabel = 'BLOWN TOILETS:';
  doc.setTextColor(BLACK);
  doc.text(blowLabel, leftX, y);
  const blowLabelW = doc.getTextWidth(blowLabel);

  const afterBlowX = leftX + blowLabelW + 3;
  const afterYesNo = drawYesNoText(doc, '', observations.blowToilets, afterBlowX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(BLACK);
  doc.text('(IF YES, LIST ADDRESSES)', afterYesNo + 3, y);

  y += 5;

  // If toilets were blown, show the addresses inline.
  if (observations.blowToilets === true && observations.toiletAddresses) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SMALL);
    doc.setTextColor(DARK_GRAY);
    const lines = doc.splitTextToSize(observations.toiletAddresses, CONTENT_W - 4);
    doc.text(lines, leftX + 4, y + 3);
    y += lines.length * 3.5 + 2;
  }

  y += 3;

  // ── THICK DIVIDER LINE ──────────────────────────────────────────────────
  drawDivider(doc, y);
  y += 3;

  // ── SCHEMATIC DRAWING SECTION (no subheader; larger area) ───────────────
  // Comments area is fixed: 5 ruled lines + header = ~36mm tall. Schematic
  // takes everything between the divider and the comments section.
  const commentsAreaH = COMMENT_LINE_COUNT * COMMENT_LINE_MM + 6;
  const schematicTop = y;
  const schematicBottom = PAGE_H - MARGIN_R - commentsAreaH - 4;
  const schematicH = schematicBottom - schematicTop;

  // Embed map image if provided — fit inside schematic rect while preserving
  // aspect ratio. Earlier code passed fixed width AND height, which stretched
  // the cropped image to fill the rect and made every map look blown up.
  if (mapImageDataUrl) {
    const imgPadding = 3;
    const boxX = MARGIN_L + imgPadding;
    const boxY = schematicTop + imgPadding;
    const boxW = CONTENT_W - imgPadding * 2;
    const boxH = schematicH - imgPadding * 2;

    try {
      const format = mapImageDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const props = doc.getImageProperties(mapImageDataUrl);
      const imgRatio = props.width / props.height;
      const boxRatio = boxW / boxH;
      let drawW: number;
      let drawH: number;
      if (imgRatio > boxRatio) {
        // Image is wider than the box — fit to width, letterbox vertically.
        drawW = boxW;
        drawH = boxW / imgRatio;
      } else {
        // Image is taller — fit to height, pillarbox horizontally.
        drawH = boxH;
        drawW = boxH * imgRatio;
      }
      const drawX = boxX + (boxW - drawW) / 2;
      const drawY = boxY + (boxH - drawH) / 2;
      doc.addImage(mapImageDataUrl, format, drawX, drawY, drawW, drawH, undefined, 'MEDIUM');
    } catch {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(FONT_SMALL);
      doc.setTextColor(DARK_GRAY);
      doc.text('(Map image could not be embedded)', PAGE_W / 2, schematicTop + schematicH / 2, {
        align: 'center',
      });
    }
  }

  // North arrow at top-left of sketch area.
  const northX = MARGIN_L + 14;
  const northY = schematicTop + 18;
  drawNorthArrow(doc, northX, northY, 14);

  // ── COMMENTS SECTION (FIXED 5 RULED LINES) ──────────────────────────────
  const commentsY = schematicBottom + 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  doc.setTextColor(BLACK);
  doc.text('COMMENTS:', MARGIN_L, commentsY);

  // Gather and render any existing comment text inline with the ruled lines.
  const allComments: string[] = [];
  if (segment.comments) allComments.push(segment.comments);
  if (observations.notes) allComments.push(observations.notes);
  const commentText = allComments.join(' | ');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_VALUE);
  const wrapped = commentText
    ? (doc.splitTextToSize(commentText, CONTENT_W - COMMENT_INDENT_MM) as string[])
    : [];

  if (wrapped.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_VALUE);
    doc.setTextColor(DARK_GRAY);
    const visibleLines = wrapped.slice(0, COMMENT_LINE_COUNT);
    if (wrapped.length > COMMENT_LINE_COUNT && visibleLines.length > 0) {
      const last = visibleLines[visibleLines.length - 1];
      visibleLines[visibleLines.length - 1] = last.replace(/\s*\S*$/, '') + ' …';
    }
    visibleLines.forEach((line, i) => {
      doc.text(line, MARGIN_L + COMMENT_INDENT_MM, commentsY + i * COMMENT_LINE_MM);
    });
  }

  // Fixed 5 ruled lines under the COMMENTS header.
  doc.setDrawColor(UNDERLINE_COLOR);
  doc.setLineWidth(0.3);
  for (let i = 0; i < COMMENT_LINE_COUNT; i++) {
    const lineY = commentsY + 2 + i * COMMENT_LINE_MM;
    doc.line(MARGIN_L, lineY, PAGE_W - MARGIN_R, lineY);
  }
}

// ── Main PDF generation ─────────────────────────────────────────────────────
export async function generatePrepSheetPdf(input: PdfInput): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
    compress: true,
  });

  doc.setProperties({
    title: `BLD Prep Sheet - Repair #${input.segment.repairNumber}`,
    subject: `${input.segment.streetName} - Job #${input.jobNumber}`,
    author: 'BLD Services LLC',
    creator: 'BLD Prep Sheet Tool',
  });

  renderPage(doc, input);

  return doc;
}

// ── Batch export: combined multi-page PDF or ZIP of individual PDFs ─────────
export async function generateBatchPdf(
  inputs: PdfInput[],
  mode: 'combined' | 'zip',
  onProgress?: (current: number, total: number) => void,
): Promise<Blob> {
  if (inputs.length === 0) {
    throw new Error('No segments to export');
  }

  if (mode === 'combined') {
    // Generate first page
    const doc = await generatePrepSheetPdf(inputs[0]);
    onProgress?.(1, inputs.length);

    // Add subsequent pages
    for (let i = 1; i < inputs.length; i++) {
      doc.addPage('letter', 'portrait');
      renderPage(doc, inputs[i]);
      onProgress?.(i + 1, inputs.length);
    }

    return doc.output('blob');
  } else {
    // ZIP mode: individual PDFs
    const zip = new JSZip();

    for (let i = 0; i < inputs.length; i++) {
      const doc = await generatePrepSheetPdf(inputs[i]);
      const blob = doc.output('blob');
      const fileName = `PrepSheet_Repair${inputs[i].segment.repairNumber}_${inputs[i].segment.streetName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      zip.file(fileName, blob);
      onProgress?.(i + 1, inputs.length);
    }

    return zip.generateAsync({ type: 'blob' });
  }
}

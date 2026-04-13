// PDF generation engine for BLD Services CIPP liner prep sheets
// Uses jsPDF to programmatically draw the prep sheet matching the official BLD template
// Rewritten to match the actual BLD+Prep.pdf template exactly:
//   - Real logo image (embedded PNG)
//   - Plain text toggles (LIGHT / MEDIUM / HIGH, YES / NO) with bold+underline for selected
//   - No radio button circles
//   - Pink highlight on "DID WE BLOW TOILETS:" label
//   - Filled blue north arrow with "NORTH" text inside the shaft

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import type { Segment, SegmentObservations } from './types';
import { BLD_LOGO_BASE64 } from './bld-logo-data';

export interface PdfInput {
  segment: Segment;
  observations: SegmentObservations;
  jobNumber: string;
  jobName: string;
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
const LINE_COLOR = '#000000';
const UNDERLINE_COLOR = '#000000';

// Font sizes
const FONT_LABEL = 10;
const FONT_VALUE = 10;
const FONT_SMALL = 8;
const FONT_SUBHEADER = 12;

// Row spacing
const ROW_GAP = 10;

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
  const arrowBottom = headBottom + shaftHeight;

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
  const { segment, observations, jobNumber, jobName, mapImageDataUrl } = input;

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

  // ── ROW 1: DATE, JOB#, REPAIR#, JOB NAME ────────────────────────────────
  const r1Y = y;
  const leftX = MARGIN_L;

  // Layout the header fields across the full width
  drawField(doc, 'DATE:', formatDate(segment), leftX, r1Y, 34);
  drawField(doc, 'JOB #', jobNumber, leftX + 36, r1Y, 32);
  drawField(doc, 'REPAIR #', segment.repairNumber, leftX + 70, r1Y, 32);
  drawField(doc, 'JOB NAME:', jobName, leftX + 104, r1Y, CONTENT_W - 104);

  y += ROW_GAP;

  // Thin line under header row
  doc.setDrawColor(UNDERLINE_COLOR);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_L, y - 2, PAGE_W - MARGIN_R, y - 2);

  y += 2;

  // ── Layout: left column and right column ────────────────────────────────
  const halfW = CONTENT_W / 2;
  const rightCol = MARGIN_L + halfW + 4;
  const rightFieldW = halfW - 4;

  // ── ROW 2: TRAFFIC: LIGHT / MEDIUM / HIGH  |  HYDRANT LOCATION:___ ─────
  drawToggleText(doc, 'TRAFFIC: ', ['LIGHT', 'MEDIUM', 'HIGH'], observations.traffic, leftX, y);
  drawField(doc, 'HYDRANT LOCATION:', observations.hydrantLocation, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 3: OVERHEAD LINES OR TREES: YES / NO  |  INCOMING LINES SIZE:___
  drawYesNoText(doc, 'OVERHEAD LINES OR TREES', observations.overheadLines, leftX, y);
  drawField(doc, 'INCOMING LINES SIZE:', observations.incomingLinesSize, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 4: WATER FLOW: LIGHT / MEDIUM / HIGH  |  U.S. DEPTH:___  D.S. DEPTH:___
  drawToggleText(doc, 'WATER FLOW: ', ['LIGHT', 'MEDIUM', 'HIGH'], observations.waterFlow, leftX, y);

  const depthFieldW = rightFieldW / 2 - 2;
  drawField(doc, 'U.S. DEPTH:', segment.usDepth, rightCol, y, depthFieldW);
  drawField(doc, 'D.S. DEPTH:', segment.dsDepth, rightCol + depthFieldW + 4, y, depthFieldW);

  y += ROW_GAP;

  // ── ROW 5: PIPE SIZE:___  PIPE LENGTH:___  |  STREET NAME:___
  const pipeFieldW = halfW / 2 - 2;
  drawField(doc, 'PIPE SIZE:', segment.pipeSize, leftX, y, pipeFieldW);
  drawField(doc, 'PIPE LENGTH:', segment.pipeLength, leftX + pipeFieldW + 4, y, pipeFieldW);
  drawField(doc, 'STREET NAME:', segment.streetName, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 6: M/H LOCATIONS: STREET / EASEMENT  |  ADDRESS OF U.S.M.H___
  drawToggleText(doc, 'M/H LOCATIONS: ', ['STREET', 'EASEMENT'], observations.mhLocation, leftX, y);
  drawField(doc, 'ADDRESS OF U.S.M.H', observations.addressUSMH, rightCol, y, rightFieldW);

  y += ROW_GAP;

  // ── ROW 7: ADDRESS OF D.S.M.H.___  |  M/H #'S:___ TO___
  drawField(doc, 'ADDRESS OF D.S.M.H.', observations.addressDSMH, leftX, y, halfW);

  const mhFieldW = rightFieldW / 2 - 6;
  drawField(doc, "M/H #'S:", segment.mhFrom, rightCol, y, mhFieldW + 14);
  drawField(doc, 'TO', segment.mhTo, rightCol + mhFieldW + 18, y, mhFieldW + 10);

  y += ROW_GAP;

  // ── ROW 8: READY TO LINE: YES / NO   NEEDS POINT REPAIR: YES / NO   INFILTRATION: YES / NO
  const tripleSpacing = CONTENT_W / 3;
  drawYesNoText(doc, 'READY TO LINE', observations.readyToLine, leftX, y);
  drawYesNoText(doc, 'NEEDS POINT REPAIR', observations.needsPointRepair, leftX + tripleSpacing + 2, y);
  drawYesNoText(doc, 'INFILTRATION', observations.infiltration, leftX + tripleSpacing * 2 + 4, y);

  y += ROW_GAP;

  // ── ROW 9: DID WE BLOW TOILETS: YES/NO (IF YES, LIST ADDRESSES!) ───────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  const blowLabel = 'DID WE BLOW TOILETS:';
  const blowLabelW = doc.getTextWidth(blowLabel);

  // Pink/salmon background highlight behind the label text
  doc.setFillColor(255, 200, 200);
  doc.rect(leftX - 1, y - 4, blowLabelW + 3, 5.5, 'F');

  // Label text on top of the highlight
  doc.setTextColor(BLACK);
  doc.text(blowLabel, leftX, y);

  // YES/NO toggle after the highlighted label
  const afterBlowX = leftX + blowLabelW + 3;
  const afterYesNo = drawYesNoText(doc, '', observations.blowToilets, afterBlowX, y);

  // "(IF YES, LIST ADDRESSES!" text
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(BLACK);
  doc.text('(IF YES, LIST ADDRESSES!', afterYesNo + 3, y);

  y += 5;

  // If toilets were blown, show the addresses
  if (observations.blowToilets === true && observations.toiletAddresses) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SMALL);
    doc.setTextColor(DARK_GRAY);
    const lines = doc.splitTextToSize(observations.toiletAddresses, CONTENT_W - 4);
    doc.text(lines, leftX + 4, y + 3);
    y += lines.length * 3.5 + 2;
  }

  y += 4;

  // ── THICK DIVIDER LINE ──────────────────────────────────────────────────
  drawDivider(doc, y);
  y += 2;

  // ── SCHEMATIC DRAWING SECTION ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_SUBHEADER);
  doc.setTextColor(BLACK);
  doc.text('SCHEMATIC DRAWING', PAGE_W / 2, y + 6, { align: 'center' });
  y += 10;

  // Schematic area: from current y to just above comments
  const commentsAreaH = 24;
  const schematicTop = y;
  const schematicBottom = PAGE_H - MARGIN_R - commentsAreaH - 4;
  const schematicH = schematicBottom - schematicTop;

  // Embed map image if provided
  if (mapImageDataUrl) {
    const imgPadding = 3;
    const imgX = MARGIN_L + imgPadding;
    const imgY = schematicTop + imgPadding;
    const imgW = CONTENT_W - imgPadding * 2;
    const imgH = schematicH - imgPadding * 2;

    try {
      const format = mapImageDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(mapImageDataUrl, format, imgX, imgY, imgW, imgH, undefined, 'MEDIUM');
    } catch {
      // If image fails, leave empty
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(FONT_SMALL);
      doc.setTextColor(LINE_COLOR);
      doc.text('(Map image could not be embedded)', PAGE_W / 2, schematicTop + schematicH / 2, {
        align: 'center',
      });
    }
  }

  // North arrow in bottom-left of schematic area
  const northX = MARGIN_L + 14;
  const northY = schematicTop + 30;
  drawNorthArrow(doc, northX, northY, 14);

  // ── COMMENTS SECTION ────────────────────────────────────────────────────
  const commentsY = schematicBottom + 6;

  // Combine segment comments and observation notes
  const allComments: string[] = [];
  if (segment.comments) allComments.push(segment.comments);
  if (observations.notes) allComments.push(observations.notes);
  const commentText = allComments.join(' | ');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_LABEL);
  doc.setTextColor(BLACK);
  doc.text('COMMENTS:', MARGIN_L, commentsY);

  if (commentText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_VALUE);
    doc.setTextColor(DARK_GRAY);
    const commentLines = doc.splitTextToSize(commentText, CONTENT_W - 28);
    doc.text(commentLines, MARGIN_L + 26, commentsY);
  }

  // Draw 3 ruled comment lines
  doc.setDrawColor(UNDERLINE_COLOR);
  doc.setLineWidth(0.3);
  for (let i = 0; i < 3; i++) {
    const lineY = commentsY + 2 + i * 6;
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

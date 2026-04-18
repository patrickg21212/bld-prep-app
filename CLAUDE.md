# BLD Prep Sheet App — Project CLAUDE.md
> This file is the single source of truth for all sessions working on this app.
> **UPDATE THIS FILE** whenever plans, scope, or build status changes.

---

## Project Summary

Standalone Windows app that automates BLD Services' CIPP liner prep sheet workflow. Camera techs upload their Excel inspection spreadsheet, select segments, auto-populate prep sheet fields, annotate a map image, and generate pixel-perfect PDFs matching BLD's official template.

**Owner:** Patrick Gibbs (Epiphany Dynamics)
**Builder:** Byte
**Advisor:** Elon (Decision Data Agent)
**Deadline:** ~2026-04-20 (BLD supervisor meeting)

---

## Business Context

- Patrick works at **BLD Services LLC** as camera tech supervisor (sewer line CIPP inspections)
- BLD is owned by **Azuria Corporation** (billion-dollar company)
- Patrick's prep sheet method is already recognized as superior (typed, map images, clean PDFs)
- At the supervisor meeting, Patrick presents his method to the entire company
- The app turns his manual process into a 60-second-per-segment workflow
- **Opportunity:** License the app to BLD/Azuria (hundreds/thousands of techs)
- **BLD has a tech division** (1-2 people, mostly SQL) who will scrutinize the app
- **Patrick will NOT show the app until they agree to pay**
- VP of the company will be at the meeting (known investor, tech-curious, uses Grok)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro + React |
| Excel parsing | SheetJS (xlsx) — client-side |
| Image annotation | Fabric.js or Konva.js |
| PDF generation | jsPDF + html2canvas |
| Persistence | IndexedDB (Dexie.js wrapper) |
| Styling | Tailwind CSS |
| Packaging | **Tauri** — standalone Windows .exe installer |

**Key constraint:** 100% client-side. No backend. No data leaves the user's machine.

---

## Full Spec

The complete product specification is at: `/root/clawd/reference/PROJECT-bld-prep-sheet-app.md`

That file contains:
- Complete Excel column-to-field mapping
- Fuzzy matching rules for column auto-mapper
- All prep sheet fields (auto-populated + field observations)
- Schematic drawing / map annotation requirements
- PDF output specifications
- UI/UX requirements (enterprise quality, dark mode)
- Screen flow (7 screens)
- Week 1 and Week 2 deliverable checklists

**READ THE FULL SPEC before making any architectural decisions.**

---

## Source Files

| File | Location | Purpose |
|------|----------|---------|
| Blank prep sheet PDF | `/root/clawd/BLD+Prep.pdf` | Template for PDF generation (match exactly) |
| Sample Excel | `/root/clawd/sample excel spreadsheet.xlsx` | Real inspection data for testing |

**Excel structure:** Headers are on Row 3 (not Row 1). Rows 1-2 are section groupings. Data starts Row 4. 130 rows, 37 columns in the sample.

---

## Data Flow

```
Excel Upload → Column Auto-Mapper → Date Range Filter (weekly batch)
    → Segment List → Select Segment → Auto-populate Form
    → Tech fills observation fields (toggles) → Upload Map Image
    → Annotate (circle segment) → Generate PDF
    → Next Segment → Batch Export Week's PDFs
```

**Weekly workflow:** Techs submit prep sheets at end of each week. Only 5-7 days of segments need generating per batch (not all 130 rows).

---

## Build Status

### Week 1 — Core (COMPLETE)
- [x] Project scaffolding (Astro + React + Tailwind)
- [x] Component structure (App, HomeScreen, ColumnMapper, ProjectSettings, SegmentList, SegmentEditor)
- [x] Excel parsing library (lib/excel.ts)
- [x] Fuzzy matching library (lib/fuzzy.ts) — with preferred/fallback alias support
- [x] IndexedDB schema (lib/db.ts)
- [x] Type definitions (lib/types.ts) — includes AnnotationData
- [x] Test with real Excel spreadsheet data — 117 segments parsed, all 13 fields mapped
- [x] Date range filter for weekly segment selection
- [x] Verify all prep sheet fields auto-populate correctly
- [x] Toggle/button inputs for observation fields
- [x] "Copy previous" for observation fields
- [x] Job-level defaults (set once, apply to all)
- [x] pipeLength fallback: CCTV Length (primary) → Plan Length (per-row fallback)
- [x] Flexible date parser handles MM/DD/YY, MM/DD/YYYY, and typos like "4/6/226"

### Week 2 — Premium (MOSTLY COMPLETE)
- [x] Map image upload with drag-and-drop (MapAnnotation.tsx, Konva.js)
- [x] Canvas annotation tools (circle, text, color, undo/redo, pan/zoom, delete)
- [x] PDF generation matching BLD template exactly (lib/pdf.ts, jsPDF)
- [x] PDF preview screen (PdfPreview.tsx)
- [x] Batch export (combined PDF or ZIP of individuals) (BatchExport.tsx)
- [x] North arrow auto-placement in schematic section
- [x] Plans PDF upload — click-to-crop map section from engineering PDF (PlanViewer.tsx)
- [x] Auto-navigate to correct map page from sheetNumber field (satellite page preferred for "9/10" format)
- [x] Stitch mode — crop from two pages side-by-side for split segments
- [x] Re-map columns option in ProjectSettings (bypasses fingerprint cache)
- [x] sheetNumber field (SHEET #) — broad fuzzy alias set, auto-patching of saved mappings
- [x] Date range filter bug fixed (null-date segments excluded when filter active)
- [x] TIME field removed from PDF output
- [x] Auto-ellipse annotation on map crops — blue (#3B82F6), neutral circle (no orientation guessing)
- [x] Worker edit controls for selected circle — Wider/Narrower/Taller/Shorter, Rotate ±15°/90°, Delete (touch-friendly)
- [x] `rotation` field added to AnnotationData, Ellipse honors it in render
- [ ] Tauri integration for standalone Windows .exe
- [ ] License key / activation system
- [ ] Final UI polish pass (animations, loading states, edge cases)

### Future (Post-Demo, If BLD Buys)
- Multi-user support with cloud sync
- Template editor (other companies' prep sheet formats)
- GraniteNet/PipeTech API integration
- Photo attachment support (manhole condition photos)
- Digital signature field
- Audit trail / version history

---

## Architecture Decisions

1. **Standalone .exe, not a website** — Tauri wraps the web app into a native Windows installer. No domain needed. No browser needed. No internet required.
2. **100% client-side** — All processing happens locally. No data leaves the machine. BLD IT security will appreciate this.
3. **Column auto-mapper with saved profiles** — Headers vary across projects/divisions. Fuzzy match on first upload, save mapping, auto-apply on subsequent uploads.
4. **Premium UI mandatory** — Dark mode default. Enterprise-grade. BLD's tech division will review this. It must look like professional software, not a hackathon project.

---

## IP Protection Strategy (Discussed, Not Yet Implemented)

- App is distributed as compiled Tauri .exe (not source code)
- License key / activation system (to be built Week 2)
- Legal licensing agreement (reverse-engineering prohibited)
- Competitive moat = Patrick's domain expertise + rapid iteration

---

## Presentation Strategy (BLD Supervisor Meeting)

1. Patrick shows his current manual method first (Edge + copy/paste + snip tool)
2. Natural transition: "What if every tech could produce prep sheets this clean?"
3. Demo the app live: upload Excel, click segment, auto-populate, add map, generate PDF
4. When asked who built it: "Epiphany Dynamics, my company"
5. Do NOT give app away. Licensing discussion only.
6. Loop in Patrick's boss (friend) beforehand as internal champion

---

## Session Log

| Date | Agent | What Changed |
|------|-------|-------------|
| 2026-04-07 | Elon | Created full product spec, field mapping from real Excel data |
| 2026-04-07 | Byte | Scaffolded project, built core components and libraries |
| 2026-04-07 | Dude | Parallel build: MapAnnotation, PDF gen, Excel testing. Integrated all. Full build passing. |
| 2026-04-08 | Dude | sheetNumber field, date alias fixes, date range filter bug, TIME field removal |
| 2026-04-09 | Dude | Plans PDF upload, PlanViewer (pdf.js v3 UMD script tag), IndexedDB ArrayBuffer fix |
| 2026-04-14 | Dude | Satellite page preference (2nd page of "9/10"), stitch mode, remap columns, broader sheetNumber aliases, page number input in viewer |
| 2026-04-14 | Dude | Deployed to GitHub + Vercel staging: https://bld-prep-staging.vercel.app |
| 2026-04-16 | Dude | Dropped auto-orientation (plans aren't always red); auto-crop now places neutral circle. Added worker edit toolbar: Wider/Narrower/Taller/Shorter, Rotate ±15°/90°, Delete. AnnotationData gained `rotation`. |

**UPDATE THIS TABLE** after every session that modifies the app.

---

## Rules for All Sessions

1. **READ THE FULL SPEC** at `/root/clawd/reference/PROJECT-bld-prep-sheet-app.md` before any work
2. **UPDATE THIS CLAUDE.md** after completing work (build status, session log)
3. **Use Context7** (`npx ctx7`) before writing code with any library
4. **Enterprise quality** — no shortcuts on UI/UX
5. **Test with real data** — use the sample Excel spreadsheet
6. **PDF must match BLD template exactly** — reference the blank PDF

# BLD Services — CIPP Liner Prep Sheet App

A web application that automates CIPP (Cured-In-Place Pipe) liner preparation sheets for BLD Services. Replaces manual spreadsheet workflows with a streamlined digital tool for field service teams.

## What It Does

- **Excel/CSV Import** — Upload existing spreadsheet data with automatic column mapping and fuzzy matching
- **Segment Editor** — Edit pipe segment details with inline validation
- **Map Annotations** — Add location-based annotations to project maps
- **PDF Generation** — Generate formatted prep sheets ready for field use
- **Batch Export** — Export multiple prep sheets at once for large projects
- **Project Settings** — Configure project-specific parameters and defaults
- **Offline-First** — All data stored locally in IndexedDB, works without internet

## Tech Stack

- **Astro** — Static site generation with island architecture
- **React** — Interactive UI components
- **TypeScript** — Type-safe development
- **IndexedDB** — Client-side persistent storage
- **jsPDF** — PDF generation
- **SheetJS** — Excel/CSV parsing and column mapping

## About

Built by [Patrick Gibbs](https://epiphanydynamics.ai) at **Epiphany Dynamics** for BLD Services, a sewer rehabilitation company. This tool replaced a manual spreadsheet workflow that was eating hours per project for the field team.

*Epiphany Dynamics — Work, Reimagined.*

import Dexie, { type Table } from 'dexie';
import type { ColumnMapping, SegmentDraft, ProjectDefaults, AppProject } from './types';

interface ProjectPlans {
  id?: number;
  projectId: string;
  pdfData: ArrayBuffer;
  fileName: string;
  numPages: number;
  savedAt: number;
}

class BldDatabase extends Dexie {
  columnMappings!: Table<ColumnMapping, number>;
  segmentDrafts!: Table<SegmentDraft, number>;
  projectDefaults!: Table<ProjectDefaults, number>;
  projects!: Table<AppProject, string>;
  projectPlans!: Table<ProjectPlans, number>;

  constructor() {
    super('BLDPrepSheet');
    this.version(1).stores({
      columnMappings: '++id, fingerprint',
      segmentDrafts: '++id, [projectId+segmentId]',
      projectDefaults: '++id, projectId',
      projects: 'id, savedAt',
    });
    this.version(2).stores({
      columnMappings: '++id, fingerprint',
      segmentDrafts: '++id, [projectId+segmentId], projectId',
      projectDefaults: '++id, projectId',
      projects: 'id, savedAt',
    });
    this.version(3).stores({
      columnMappings: '++id, fingerprint',
      segmentDrafts: '++id, [projectId+segmentId], projectId',
      projectDefaults: '++id, projectId',
      projects: 'id, savedAt',
      projectPlans: '++id, projectId',
    });
  }
}

export const db = new BldDatabase();

// ColumnMapping helpers
export async function getSavedMapping(fingerprint: string): Promise<ColumnMapping | undefined> {
  return db.columnMappings.where('fingerprint').equals(fingerprint).first();
}

export async function saveMapping(mapping: ColumnMapping): Promise<void> {
  const existing = await getSavedMapping(mapping.fingerprint);
  if (existing?.id) {
    await db.columnMappings.update(existing.id, { ...mapping, savedAt: Date.now() });
  } else {
    await db.columnMappings.add({ ...mapping, savedAt: Date.now() });
  }
}

// Draft helpers
export async function getDraft(projectId: string, segmentId: string): Promise<SegmentDraft | undefined> {
  return db.segmentDrafts.where('[projectId+segmentId]').equals([projectId, segmentId]).first();
}

export async function saveDraft(draft: SegmentDraft): Promise<void> {
  const existing = await getDraft(draft.projectId, draft.segmentId);
  if (existing?.id) {
    await db.segmentDrafts.update(existing.id, { ...draft, savedAt: Date.now() });
  } else {
    await db.segmentDrafts.add({ ...draft, savedAt: Date.now() });
  }
}

export async function getAllDrafts(projectId: string): Promise<SegmentDraft[]> {
  return db.segmentDrafts.where('projectId').equals(projectId).toArray();
}

// Project defaults helpers
export async function getProjectDefaults(projectId: string): Promise<ProjectDefaults | undefined> {
  return db.projectDefaults.where('projectId').equals(projectId).first();
}

export async function saveProjectDefaults(defaults: ProjectDefaults): Promise<void> {
  const existing = await getProjectDefaults(defaults.projectId);
  if (existing?.id) {
    await db.projectDefaults.update(existing.id, { ...defaults, savedAt: Date.now() });
  } else {
    await db.projectDefaults.add({ ...defaults, savedAt: Date.now() });
  }
}

// Project helpers
export async function getRecentProjects(): Promise<AppProject[]> {
  return db.projects.orderBy('savedAt').reverse().limit(10).toArray();
}

export async function saveProject(project: AppProject): Promise<void> {
  await db.projects.put({ ...project, savedAt: Date.now() });
}

export async function getProject(id: string): Promise<AppProject | undefined> {
  return db.projects.get(id);
}

// Project plans helpers
export async function savePlans(projectId: string, pdfData: ArrayBuffer, fileName: string, numPages: number): Promise<void> {
  const existing = await db.projectPlans.where('projectId').equals(projectId).first();
  if (existing?.id) {
    await db.projectPlans.update(existing.id, { pdfData, fileName, numPages, savedAt: Date.now() });
  } else {
    await db.projectPlans.add({ projectId, pdfData, fileName, numPages, savedAt: Date.now() });
  }
}

export async function getPlans(projectId: string): Promise<ProjectPlans | undefined> {
  return db.projectPlans.where('projectId').equals(projectId).first();
}

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { StateChange, TemporalEdge } from '@/types/graph';
import {
  loadTraceArtifacts,
  type DebugEntityLite,
  type DebugEventRecord,
  type DebugSceneIndexRecord,
} from '@/lib/traceData';

type JsonObject = Record<string, unknown>;

type RawEnvelope = {
  metadata?: JsonObject;
  items?: unknown[];
};

type ScriptBlockLite = {
  blockId: string;
  sceneId: string;
  blockType: string;
  sequenceInScene: number;
  lineStart: number;
  lineEnd: number;
  text: string;
  speakerCueRaw: string | null;
  utteranceId: string | null;
  actionId: string | null;
};

export type NtgTemporalEdgeRecord = TemporalEdge;

export type NtgStateChangeRecord = StateChange & {
  metadata: JsonObject;
};

type NtgArtifacts = {
  available: boolean;
  events: DebugEventRecord[];
  sceneIndex: DebugSceneIndexRecord[];
  entities: DebugEntityLite[];
  temporalEdges: NtgTemporalEdgeRecord[];
  stateChanges: NtgStateChangeRecord[];
  scriptBlocks: ScriptBlockLite[];
  eventById: Map<string, DebugEventRecord>;
  sceneById: Map<string, DebugSceneIndexRecord>;
  entityById: Map<string, DebugEntityLite>;
  temporalOutByEventId: Map<string, NtgTemporalEdgeRecord[]>;
  temporalInByEventId: Map<string, NtgTemporalEdgeRecord[]>;
  stateChangesByEventId: Map<string, NtgStateChangeRecord[]>;
  stateChangesBySceneId: Map<string, NtgStateChangeRecord[]>;
  scriptBlocksBySceneId: Map<string, ScriptBlockLite[]>;
  eventsBySceneId: Map<string, DebugEventRecord[]>;
  metadata: {
    events: JsonObject;
    eventParticipants: JsonObject;
    sceneIndex: JsonObject;
    temporalEdges: JsonObject;
    stateChanges: JsonObject;
    scriptBlocks: JsonObject;
  };
  missingFiles: string[];
};

export type PairOption = {
  value: string;
  entityAId: string;
  entityBId: string;
  label: string;
  count: number;
};

export type TraceExplorerRow = {
  event: DebugEventRecord;
  scene: DebugSceneIndexRecord | null;
  participants: Array<{
    entityId: string;
    role: string;
    canonicalName: string | null;
    entityType: string | null;
  }>;
  incomingTemporal: NtgTemporalEdgeRecord[];
  outgoingTemporal: NtgTemporalEdgeRecord[];
  stateChangesTriggered: Array<{
    stateChangeId: string;
    subjectId: string;
    objectId: string;
    subjectName: string | null;
    objectName: string | null;
    stateDimension: string;
    direction: NtgStateChangeRecord['direction'];
    magnitude: NtgStateChangeRecord['magnitude'];
    claimType: NtgStateChangeRecord['claimType'];
    confidence: number;
  }>;
};

export type TimelineSceneRow = {
  scene: DebugSceneIndexRecord;
  year: number | null;
  events: DebugEventRecord[];
  matchingEventCount: number;
  stateChanges: NtgStateChangeRecord[];
  matchingStateChangeCount: number;
  scriptBlocks: ScriptBlockLite[];
};

const DERIVED_DIR = path.join(process.cwd(), 'data', 'derived');
const INTERMEDIATE_DIR = path.join(process.cwd(), 'data', 'intermediate');
const TEMPORAL_EDGES_PATH = path.join(DERIVED_DIR, 'temporal_edges.json');
const STATE_CHANGES_PATH = path.join(DERIVED_DIR, 'state_changes.json');
const SCRIPT_BLOCKS_PATH = path.join(INTERMEDIATE_DIR, 'script_blocks.json');

let ntgArtifactsCache: Promise<NtgArtifacts> | null = null;

function pairValue(a: string, b: string): string {
  return [a, b].sort().join('::');
}

function getSceneYear(scene: DebugSceneIndexRecord | null | undefined): number | null {
  if (!scene) return null;
  return scene.yearExplicit ?? scene.yearInferred ?? null;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

async function readEnvelope(filePath: string): Promise<RawEnvelope | null> {
  if (!(await fileExists(filePath))) return null;
  const parsed = await readJson(filePath);
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as RawEnvelope;
  if (!Array.isArray(env.items)) return null;
  return env;
}

function normalizeTemporalEdge(raw: unknown): NtgTemporalEdgeRecord | null {
  const obj = asObject(raw);
  const temporalEdgeId = asString(obj.temporal_edge_id);
  const fromEventId = asString(obj.from_event_id);
  const toEventId = asString(obj.to_event_id);
  const relation = asString(obj.relation);
  const basis = asString(obj.basis);
  if (!temporalEdgeId || !fromEventId || !toEventId || !relation || !basis) return null;
  return {
    temporalEdgeId,
    fromEventId,
    toEventId,
    relation: relation as NtgTemporalEdgeRecord['relation'],
    basis,
  };
}

function normalizeStateChange(raw: unknown): NtgStateChangeRecord | null {
  const obj = asObject(raw);
  const stateChangeId = asString(obj.state_change_id);
  const subjectId = asString(obj.subject_id);
  const objectId = asString(obj.object_id);
  const stateDimension = asString(obj.state_dimension);
  const direction = asString(obj.direction);
  const sceneId = asString(obj.scene_id);
  const inferenceMethod = asString(obj.inference_method);
  const claimType = asString(obj.claim_type);
  const confidence = asNumber(obj.confidence);
  if (
    !stateChangeId ||
    !subjectId ||
    !objectId ||
    !stateDimension ||
    !direction ||
    !sceneId ||
    !inferenceMethod ||
    !claimType ||
    confidence === null
  ) {
    return null;
  }
  if (!['increase', 'decrease', 'shift', 'break', 'repair_attempt', 'stabilize'].includes(direction)) {
    return null;
  }
  if (!['explicit', 'inferred'].includes(claimType)) {
    return null;
  }
  const magnitudeRaw = asString(obj.magnitude);
  const magnitude =
    magnitudeRaw && ['low', 'medium', 'high'].includes(magnitudeRaw) ? (magnitudeRaw as 'low' | 'medium' | 'high') : null;
  return {
    stateChangeId,
    subjectId,
    objectId,
    stateDimension,
    direction: direction as NtgStateChangeRecord['direction'],
    magnitude,
    sceneId,
    triggerEventIds: asStringArray(obj.trigger_event_ids),
    evidenceRefs: asStringArray(obj.evidence_refs),
    confidence,
    inferenceMethod,
    claimType: claimType as NtgStateChangeRecord['claimType'],
    metadata: asObject(obj.metadata),
  };
}

function normalizeScriptBlock(raw: unknown): ScriptBlockLite | null {
  const obj = asObject(raw);
  const blockId = asString(obj.block_id);
  const sceneId = asString(obj.scene_id);
  const blockType = asString(obj.block_type);
  const sequenceInScene = asNumber(obj.sequence_in_scene);
  const lineStart = asNumber(obj.line_start);
  const lineEnd = asNumber(obj.line_end);
  const text = asString(obj.text);
  if (!blockId || !sceneId || !blockType || sequenceInScene === null || lineStart === null || lineEnd === null || text === null) {
    return null;
  }
  return {
    blockId,
    sceneId,
    blockType,
    sequenceInScene,
    lineStart,
    lineEnd,
    text,
    speakerCueRaw: asString(obj.speaker_cue_raw),
    utteranceId: asString(obj.utterance_id),
    actionId: asString(obj.action_id),
  };
}

async function loadNtgArtifactsUncached(): Promise<NtgArtifacts> {
  const traceArtifacts = await loadTraceArtifacts();
  const [temporalEnv, stateEnv, scriptBlocksEnv] = await Promise.all([
    readEnvelope(TEMPORAL_EDGES_PATH),
    readEnvelope(STATE_CHANGES_PATH),
    readEnvelope(SCRIPT_BLOCKS_PATH),
  ]);

  const missingFiles = [...(traceArtifacts.available ? [] : traceArtifacts.missingFiles)];
  if (!temporalEnv) missingFiles.push('data/derived/temporal_edges.json');
  if (!stateEnv) missingFiles.push('data/derived/state_changes.json');
  if (!scriptBlocksEnv) missingFiles.push('data/intermediate/script_blocks.json');

  if (!traceArtifacts.available || !temporalEnv || !stateEnv || !scriptBlocksEnv) {
    return {
      available: false,
      events: [],
      sceneIndex: [],
      entities: [],
      temporalEdges: [],
      stateChanges: [],
      scriptBlocks: [],
      eventById: new Map(),
      sceneById: new Map(),
      entityById: new Map(),
      temporalOutByEventId: new Map(),
      temporalInByEventId: new Map(),
      stateChangesByEventId: new Map(),
      stateChangesBySceneId: new Map(),
      scriptBlocksBySceneId: new Map(),
      eventsBySceneId: new Map(),
      metadata: {
        events: traceArtifacts.metadata.events,
        eventParticipants: traceArtifacts.metadata.eventParticipants,
        sceneIndex: traceArtifacts.metadata.sceneIndex,
        temporalEdges: {},
        stateChanges: {},
        scriptBlocks: {},
      },
      missingFiles: Array.from(new Set(missingFiles)),
    };
  }

  const temporalEdges = (temporalEnv.items ?? [])
    .map(normalizeTemporalEdge)
    .filter((x): x is NtgTemporalEdgeRecord => x !== null);

  const stateChanges = (stateEnv.items ?? [])
    .map(normalizeStateChange)
    .filter((x): x is NtgStateChangeRecord => x !== null);

  const scriptBlocks = (scriptBlocksEnv.items ?? [])
    .map(normalizeScriptBlock)
    .filter((x): x is ScriptBlockLite => x !== null)
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.sequenceInScene - b.sequenceInScene || a.blockId.localeCompare(b.blockId));

  const temporalOutByEventId = new Map<string, NtgTemporalEdgeRecord[]>();
  const temporalInByEventId = new Map<string, NtgTemporalEdgeRecord[]>();
  for (const edge of temporalEdges) {
    const out = temporalOutByEventId.get(edge.fromEventId) ?? [];
    out.push(edge);
    temporalOutByEventId.set(edge.fromEventId, out);

    const incoming = temporalInByEventId.get(edge.toEventId) ?? [];
    incoming.push(edge);
    temporalInByEventId.set(edge.toEventId, incoming);
  }
  for (const rows of temporalOutByEventId.values()) rows.sort((a, b) => a.temporalEdgeId.localeCompare(b.temporalEdgeId));
  for (const rows of temporalInByEventId.values()) rows.sort((a, b) => a.temporalEdgeId.localeCompare(b.temporalEdgeId));

  const stateChangesByEventId = new Map<string, NtgStateChangeRecord[]>();
  const stateChangesBySceneId = new Map<string, NtgStateChangeRecord[]>();
  for (const sc of stateChanges) {
    for (const eventId of sc.triggerEventIds) {
      const rows = stateChangesByEventId.get(eventId) ?? [];
      rows.push(sc);
      stateChangesByEventId.set(eventId, rows);
    }
    const rows = stateChangesBySceneId.get(sc.sceneId) ?? [];
    rows.push(sc);
    stateChangesBySceneId.set(sc.sceneId, rows);
  }
  for (const rows of stateChangesByEventId.values()) rows.sort((a, b) => a.stateChangeId.localeCompare(b.stateChangeId));
  for (const rows of stateChangesBySceneId.values()) rows.sort((a, b) => a.stateChangeId.localeCompare(b.stateChangeId));

  const scriptBlocksBySceneId = new Map<string, ScriptBlockLite[]>();
  for (const block of scriptBlocks) {
    const rows = scriptBlocksBySceneId.get(block.sceneId) ?? [];
    rows.push(block);
    scriptBlocksBySceneId.set(block.sceneId, rows);
  }
  for (const rows of scriptBlocksBySceneId.values()) {
    rows.sort((a, b) => a.sequenceInScene - b.sequenceInScene || a.lineStart - b.lineStart || a.blockId.localeCompare(b.blockId));
  }

  const eventsBySceneId = new Map<string, DebugEventRecord[]>();
  for (const event of traceArtifacts.events) {
    const rows = eventsBySceneId.get(event.sceneId) ?? [];
    rows.push(event);
    eventsBySceneId.set(event.sceneId, rows);
  }
  for (const [sceneId, rows] of eventsBySceneId.entries()) {
    const scene = traceArtifacts.sceneById.get(sceneId);
    const sceneOrder = scene?.sceneIndex ?? Number.MAX_SAFE_INTEGER;
    void sceneOrder;
    rows.sort((a, b) => a.sequenceInScene - b.sequenceInScene || a.eventId.localeCompare(b.eventId));
  }

  return {
    available: true,
    events: traceArtifacts.events,
    sceneIndex: traceArtifacts.sceneIndex,
    entities: traceArtifacts.entities,
    temporalEdges,
    stateChanges,
    scriptBlocks,
    eventById: traceArtifacts.eventById,
    sceneById: traceArtifacts.sceneById,
    entityById: traceArtifacts.entityById,
    temporalOutByEventId,
    temporalInByEventId,
    stateChangesByEventId,
    stateChangesBySceneId,
    scriptBlocksBySceneId,
    eventsBySceneId,
    metadata: {
      events: traceArtifacts.metadata.events,
      eventParticipants: traceArtifacts.metadata.eventParticipants,
      sceneIndex: traceArtifacts.metadata.sceneIndex,
      temporalEdges: asObject(temporalEnv.metadata),
      stateChanges: asObject(stateEnv.metadata),
      scriptBlocks: asObject(scriptBlocksEnv.metadata),
    },
    missingFiles: [],
  };
}

export function invalidateNtgArtifactsCache(): void {
  ntgArtifactsCache = null;
}

export async function loadNtgArtifacts(): Promise<NtgArtifacts> {
  if (!ntgArtifactsCache) {
    ntgArtifactsCache = loadNtgArtifactsUncached();
  }
  return ntgArtifactsCache;
}

function entityDisplayName(entity: DebugEntityLite | undefined): string | null {
  return entity?.canonicalName ?? null;
}

function getEventEvidenceSnippets(event: DebugEventRecord): string[] {
  const spans = Array.isArray(event.metadata.evidence_spans) ? event.metadata.evidence_spans : [];
  const snippets: string[] = [];
  for (const span of spans) {
    const obj = asObject(span);
    const snippet = asString(obj.snippet);
    if (snippet) snippets.push(snippet);
  }
  return snippets;
}

function eventTouchesPair(event: DebugEventRecord, pairFilter: string): boolean {
  if (!pairFilter) return true;
  const ids = Array.from(new Set(event.participants.map((p) => p.entityId)));
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (pairValue(ids[i], ids[j]) === pairFilter) return true;
    }
  }
  return false;
}

function stateChangeTouchesPair(sc: NtgStateChangeRecord, pairFilter: string): boolean {
  return !pairFilter || pairValue(sc.subjectId, sc.objectId) === pairFilter;
}

function buildPairOptions(artifacts: NtgArtifacts): PairOption[] {
  const counts = new Map<string, { entityAId: string; entityBId: string; count: number }>();
  for (const sc of artifacts.stateChanges) {
    const value = pairValue(sc.subjectId, sc.objectId);
    const [entityAId, entityBId] = value.split('::');
    const current = counts.get(value) ?? { entityAId, entityBId, count: 0 };
    current.count += 1;
    counts.set(value, current);
  }
  const rows: PairOption[] = [];
  for (const [value, row] of counts.entries()) {
    const aName = entityDisplayName(artifacts.entityById.get(row.entityAId)) ?? row.entityAId;
    const bName = entityDisplayName(artifacts.entityById.get(row.entityBId)) ?? row.entityBId;
    rows.push({
      value,
      entityAId: row.entityAId,
      entityBId: row.entityBId,
      label: `${aName} <> ${bName}`,
      count: row.count,
    });
  }
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return rows;
}

function sceneLocationText(scene: DebugSceneIndexRecord | undefined): string {
  if (!scene) return '';
  return `${scene.locationRaw} ${scene.headerRaw}`.toLowerCase();
}

export async function getNtgSummary(): Promise<{
  available: boolean;
  eventCount: number;
  temporalEdgeCount: number;
  stateChangeCount: number;
  sceneCount: number;
  pairOptionCount: number;
  metadata?: NtgArtifacts['metadata'];
  missingFiles?: string[];
}> {
  const artifacts = await loadNtgArtifacts();
  if (!artifacts.available) {
    return {
      available: false,
      eventCount: 0,
      temporalEdgeCount: 0,
      stateChangeCount: 0,
      sceneCount: 0,
      pairOptionCount: 0,
      missingFiles: artifacts.missingFiles,
    };
  }
  const pairOptions = buildPairOptions(artifacts);
  return {
    available: true,
    eventCount: artifacts.events.length,
    temporalEdgeCount: artifacts.temporalEdges.length,
    stateChangeCount: artifacts.stateChanges.length,
    sceneCount: artifacts.sceneIndex.length,
    pairOptionCount: pairOptions.length,
    metadata: artifacts.metadata,
  };
}

export type ListStateChangesOptions = {
  stateChangeId?: string;
  subjectId?: string;
  objectId?: string;
  entityId?: string;
  pair?: string;
  stateDimension?: string;
  claimType?: 'explicit' | 'inferred' | '';
  sceneId?: string;
  limit?: number;
};

export async function listStateChanges(options: ListStateChangesOptions = {}) {
  const artifacts = await loadNtgArtifacts();
  if (!artifacts.available) {
    return {
      available: false,
      items: [] as Array<{
        stateChange: NtgStateChangeRecord;
        subject: DebugEntityLite | null;
        object: DebugEntityLite | null;
        scene: DebugSceneIndexRecord | null;
        triggerEvents: DebugEventRecord[];
      }>,
      total: 0,
      filtered: 0,
      missingFiles: artifacts.missingFiles,
      stateDimensionOptions: [] as string[],
      claimTypeOptions: [] as Array<'explicit' | 'inferred'>,
      pairOptions: [] as PairOption[],
    };
  }

  const subjectId = (options.subjectId ?? '').trim();
  const objectId = (options.objectId ?? '').trim();
  const stateChangeId = (options.stateChangeId ?? '').trim();
  const entityId = (options.entityId ?? '').trim();
  const pair = (options.pair ?? '').trim();
  const stateDimension = (options.stateDimension ?? '').trim();
  const claimType = (options.claimType ?? '').trim();
  const sceneId = (options.sceneId ?? '').trim();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));

  let rows = artifacts.stateChanges;
  if (stateChangeId) rows = rows.filter((sc) => sc.stateChangeId === stateChangeId);
  if (subjectId) rows = rows.filter((sc) => sc.subjectId === subjectId);
  if (objectId) rows = rows.filter((sc) => sc.objectId === objectId);
  if (entityId) rows = rows.filter((sc) => sc.subjectId === entityId || sc.objectId === entityId);
  if (pair) rows = rows.filter((sc) => stateChangeTouchesPair(sc, pair));
  if (stateDimension) rows = rows.filter((sc) => sc.stateDimension === stateDimension);
  if (claimType && ['explicit', 'inferred'].includes(claimType)) rows = rows.filter((sc) => sc.claimType === claimType);
  if (sceneId) rows = rows.filter((sc) => sc.sceneId === sceneId);

  rows = [...rows].sort((a, b) => a.stateChangeId.localeCompare(b.stateChangeId));

  const items = rows.slice(0, limit).map((sc) => ({
    stateChange: sc,
    subject: artifacts.entityById.get(sc.subjectId) ?? null,
    object: artifacts.entityById.get(sc.objectId) ?? null,
    scene: artifacts.sceneById.get(sc.sceneId) ?? null,
    triggerEvents: sc.triggerEventIds.map((eventId) => artifacts.eventById.get(eventId)).filter((e): e is DebugEventRecord => !!e),
  }));

  return {
    available: true,
    items,
    total: artifacts.stateChanges.length,
    filtered: rows.length,
    stateDimensionOptions: [...new Set(artifacts.stateChanges.map((sc) => sc.stateDimension))].sort(),
    claimTypeOptions: ['explicit', 'inferred'] as Array<'explicit' | 'inferred'>,
    pairOptions: buildPairOptions(artifacts),
  };
}

export type TraceExplorerOptions = {
  q?: string;
  sceneId?: string;
  eventId?: string;
  entityId?: string;
  eventType?: string;
  year?: number | null;
  pair?: string;
  locationQ?: string;
  limit?: number;
};

export async function listTraceExplorerEvents(options: TraceExplorerOptions = {}) {
  const artifacts = await loadNtgArtifacts();
  if (!artifacts.available) {
    return {
      available: false,
      items: [] as TraceExplorerRow[],
      total: 0,
      filtered: 0,
      missingFiles: artifacts.missingFiles,
      eventTypeOptions: [] as string[],
      yearOptions: [] as number[],
      entityOptions: [] as DebugEntityLite[],
      pairOptions: [] as PairOption[],
    };
  }

  const q = (options.q ?? '').trim().toLowerCase();
  const sceneId = (options.sceneId ?? '').trim();
  const eventId = (options.eventId ?? '').trim();
  const entityId = (options.entityId ?? '').trim();
  const eventType = (options.eventType ?? '').trim();
  const pair = (options.pair ?? '').trim();
  const locationQ = (options.locationQ ?? '').trim().toLowerCase();
  const year = typeof options.year === 'number' && Number.isFinite(options.year) ? options.year : null;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));

  let rows = artifacts.events;
  if (sceneId) rows = rows.filter((e) => e.sceneId === sceneId);
  if (eventId) rows = rows.filter((e) => e.eventId === eventId);
  if (eventType) rows = rows.filter((e) => e.eventTypeL2 === eventType);
  if (entityId) rows = rows.filter((e) => e.participants.some((p) => p.entityId === entityId));
  if (pair) rows = rows.filter((e) => eventTouchesPair(e, pair));
  if (year !== null) rows = rows.filter((e) => getSceneYear(artifacts.sceneById.get(e.sceneId)) === year);
  if (locationQ) rows = rows.filter((e) => sceneLocationText(artifacts.sceneById.get(e.sceneId)).includes(locationQ));
  if (q) {
    rows = rows.filter((e) => {
      if (e.eventId.toLowerCase().includes(q)) return true;
      if (e.eventTypeL1.toLowerCase().includes(q)) return true;
      if (e.eventTypeL2.toLowerCase().includes(q)) return true;
      if (e.summary.toLowerCase().includes(q)) return true;
      return getEventEvidenceSnippets(e).some((snippet) => snippet.toLowerCase().includes(q));
    });
  }

  rows = [...rows].sort((a, b) => {
    const aScene = artifacts.sceneById.get(a.sceneId)?.sceneIndex ?? Number.MAX_SAFE_INTEGER;
    const bScene = artifacts.sceneById.get(b.sceneId)?.sceneIndex ?? Number.MAX_SAFE_INTEGER;
    return aScene - bScene || a.sequenceInScene - b.sequenceInScene || a.eventId.localeCompare(b.eventId);
  });

  const items: TraceExplorerRow[] = rows.slice(0, limit).map((event) => {
    const scene = artifacts.sceneById.get(event.sceneId) ?? null;
    const participants = event.participants.map((p) => {
      const entity = artifacts.entityById.get(p.entityId);
      return {
        entityId: p.entityId,
        role: p.role,
        canonicalName: entity?.canonicalName ?? null,
        entityType: entity?.entityType ?? null,
      };
    });

    const stateChangesTriggered = (artifacts.stateChangesByEventId.get(event.eventId) ?? []).map((sc) => ({
      stateChangeId: sc.stateChangeId,
      subjectId: sc.subjectId,
      objectId: sc.objectId,
      subjectName: entityDisplayName(artifacts.entityById.get(sc.subjectId)),
      objectName: entityDisplayName(artifacts.entityById.get(sc.objectId)),
      stateDimension: sc.stateDimension,
      direction: sc.direction,
      magnitude: sc.magnitude,
      claimType: sc.claimType,
      confidence: sc.confidence,
    }));

    return {
      event,
      scene,
      participants,
      incomingTemporal: artifacts.temporalInByEventId.get(event.eventId) ?? [],
      outgoingTemporal: artifacts.temporalOutByEventId.get(event.eventId) ?? [],
      stateChangesTriggered,
    };
  });

  const yearOptions = [...new Set(artifacts.sceneIndex.map((scene) => getSceneYear(scene)).filter((v): v is number => v !== null))].sort(
    (a, b) => a - b,
  );

  return {
    available: true,
    items,
    total: artifacts.events.length,
    filtered: rows.length,
    eventTypeOptions: [...new Set(artifacts.events.map((e) => e.eventTypeL2))].sort(),
    yearOptions,
    entityOptions: artifacts.entities.filter((e) => e.entityType !== 'location'),
    pairOptions: buildPairOptions(artifacts),
  };
}

export type TimelineOptions = {
  year?: number | null;
  entityId?: string;
  eventType?: string;
  pair?: string;
  q?: string;
  limitScenes?: number;
  includeBlocks?: boolean;
};

export async function getTimelineSlice(options: TimelineOptions = {}) {
  const artifacts = await loadNtgArtifacts();
  if (!artifacts.available) {
    return {
      available: false,
      scenes: [] as TimelineSceneRow[],
      totalScenes: 0,
      filteredScenes: 0,
      totalEvents: 0,
      missingFiles: artifacts.missingFiles,
      yearOptions: [] as number[],
      eventTypeOptions: [] as string[],
      entityOptions: [] as DebugEntityLite[],
      pairOptions: [] as PairOption[],
    };
  }

  const year = typeof options.year === 'number' && Number.isFinite(options.year) ? options.year : null;
  const entityId = (options.entityId ?? '').trim();
  const eventType = (options.eventType ?? '').trim();
  const pair = (options.pair ?? '').trim();
  const q = (options.q ?? '').trim().toLowerCase();
  const includeBlocks = Boolean(options.includeBlocks);
  const limitScenes = Math.max(1, Math.min(options.limitScenes ?? 24, 120));

  const sceneRows = [...artifacts.sceneIndex].sort((a, b) => a.sceneIndex - b.sceneIndex || a.sceneId.localeCompare(b.sceneId));

  const filteredSceneRows: TimelineSceneRow[] = [];

  for (const scene of sceneRows) {
    const sceneYear = getSceneYear(scene);
    if (year !== null && sceneYear !== year) continue;

    const sceneEvents = artifacts.eventsBySceneId.get(scene.sceneId) ?? [];
    const sceneStateChanges = artifacts.stateChangesBySceneId.get(scene.sceneId) ?? [];
    const sceneBlocks = includeBlocks ? artifacts.scriptBlocksBySceneId.get(scene.sceneId) ?? [] : [];

    const matchingEvents = sceneEvents.filter((event) => {
      if (eventType && event.eventTypeL2 !== eventType) return false;
      if (entityId && !event.participants.some((p) => p.entityId === entityId)) return false;
      if (pair && !eventTouchesPair(event, pair)) return false;
      if (q) {
        const text = `${event.summary}\n${getEventEvidenceSnippets(event).join('\n')}`.toLowerCase();
        if (!text.includes(q) && !event.eventTypeL2.toLowerCase().includes(q) && !event.eventId.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const matchingStateChanges = sceneStateChanges.filter((sc) => {
      if (entityId && sc.subjectId !== entityId && sc.objectId !== entityId) return false;
      if (pair && !stateChangeTouchesPair(sc, pair)) return false;
      if (q) {
        const text = `${sc.stateChangeId} ${sc.stateDimension} ${sc.direction} ${sc.claimType}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (entityId || eventType || pair || q) {
      if (matchingEvents.length === 0 && matchingStateChanges.length === 0) continue;
    }

    filteredSceneRows.push({
      scene,
      year: sceneYear,
      events: sceneEvents,
      matchingEventCount: matchingEvents.length,
      stateChanges: sceneStateChanges,
      matchingStateChangeCount: matchingStateChanges.length,
      scriptBlocks: sceneBlocks,
    });

    if (filteredSceneRows.length >= limitScenes) break;
  }

  return {
    available: true,
    scenes: filteredSceneRows,
    totalScenes: artifacts.sceneIndex.length,
    filteredScenes: filteredSceneRows.length,
    totalEvents: artifacts.events.length,
    yearOptions: [...new Set(artifacts.sceneIndex.map((scene) => getSceneYear(scene)).filter((v): v is number => v !== null))].sort((a, b) => a - b),
    eventTypeOptions: [...new Set(artifacts.events.map((e) => e.eventTypeL2))].sort(),
    entityOptions: artifacts.entities.filter((e) => e.entityType !== 'location'),
    pairOptions: buildPairOptions(artifacts),
  };
}

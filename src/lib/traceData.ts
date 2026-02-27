import { promises as fs } from 'node:fs';
import path from 'node:path';

type JsonObject = Record<string, unknown>;

type RawEnvelope = {
  metadata?: JsonObject;
  items?: unknown[];
};

export type DebugEventRecord = {
  eventId: string;
  sceneId: string;
  eventTypeL1: string;
  eventTypeL2: string;
  summary: string;
  participants: Array<{ entityId: string; role: string }>;
  evidenceRefs: string[];
  sequenceInScene: number;
  confidence: number;
  extractionMethod: string;
  metadata: JsonObject;
};

export type DebugEventParticipantRecord = {
  eventParticipantId: string;
  eventId: string;
  sceneId: string;
  entityId: string;
  role: string;
  participantIndex: number;
  evidenceRefs: string[];
  confidence: number;
  extractionMethod: string;
};

export type DebugSceneIndexRecord = {
  sceneId: string;
  sceneIndex: number;
  headerRaw: string;
  headerPrefix: string;
  locationRaw: string;
  locationCanonicalId: string | null;
  timeOfDay: string | null;
  yearExplicit: number | null;
  yearInferred: number | null;
  flags: string[];
  lineStart: number | null;
  lineEnd: number | null;
  eventCount: number;
  eventTypeL1Counts: Record<string, number>;
  eventTypeL2Counts: Record<string, number>;
  participantEntityIds: string[];
  eventRefs: Array<{
    eventId: string;
    eventTypeL1: string;
    eventTypeL2: string;
    sequenceInScene: number;
    summary: string;
    evidenceRefs: string[];
  }>;
};

export type DebugEntityLite = {
  entityId: string;
  entityType: string;
  canonicalName: string;
};

type TraceArtifacts = {
  available: boolean;
  events: DebugEventRecord[];
  eventParticipants: DebugEventParticipantRecord[];
  sceneIndex: DebugSceneIndexRecord[];
  entities: DebugEntityLite[];
  eventById: Map<string, DebugEventRecord>;
  sceneById: Map<string, DebugSceneIndexRecord>;
  entityById: Map<string, DebugEntityLite>;
  metadata: {
    events: JsonObject;
    eventParticipants: JsonObject;
    sceneIndex: JsonObject;
  };
  missingFiles: string[];
};

const DERIVED_DIR = path.join(process.cwd(), 'data', 'derived');
const EVENTS_PATH = path.join(DERIVED_DIR, 'events.json');
const EVENT_PARTICIPANTS_PATH = path.join(DERIVED_DIR, 'event_participants.json');
const SCENE_INDEX_PATH = path.join(DERIVED_DIR, 'scene_index.json');
const ENTITIES_PATH = path.join(DERIVED_DIR, 'entities.json');

let traceArtifactsCache: Promise<TraceArtifacts> | null = null;

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

function normalizeEvent(raw: unknown): DebugEventRecord | null {
  const obj = asObject(raw);
  const participantsRaw = Array.isArray(obj.participants) ? obj.participants : [];
  const participants = participantsRaw
    .map((p) => {
      const po = asObject(p);
      const entityId = asString(po.entity_id);
      const role = asString(po.role);
      if (!entityId || !role) return null;
      return { entityId, role };
    })
    .filter((p): p is { entityId: string; role: string } => p !== null);

  const eventId = asString(obj.event_id);
  const sceneId = asString(obj.scene_id);
  const eventTypeL1 = asString(obj.event_type_l1);
  const eventTypeL2 = asString(obj.event_type_l2);
  const summary = asString(obj.summary);
  const sequenceInScene = asNumber(obj.sequence_in_scene);
  const confidence = asNumber(obj.confidence);
  const extractionMethod = asString(obj.extraction_method);
  if (!eventId || !sceneId || !eventTypeL1 || !eventTypeL2 || !summary || sequenceInScene === null || confidence === null || !extractionMethod) {
    return null;
  }

  return {
    eventId,
    sceneId,
    eventTypeL1,
    eventTypeL2,
    summary,
    participants,
    evidenceRefs: asStringArray(obj.evidence_refs),
    sequenceInScene,
    confidence,
    extractionMethod,
    metadata: asObject(obj.metadata),
  };
}

function normalizeEventParticipant(raw: unknown): DebugEventParticipantRecord | null {
  const obj = asObject(raw);
  const eventParticipantId = asString(obj.event_participant_id);
  const eventId = asString(obj.event_id);
  const sceneId = asString(obj.scene_id);
  const entityId = asString(obj.entity_id);
  const role = asString(obj.role);
  const participantIndex = asNumber(obj.participant_index);
  const confidence = asNumber(obj.confidence);
  const extractionMethod = asString(obj.extraction_method);
  if (!eventParticipantId || !eventId || !sceneId || !entityId || !role || participantIndex === null || confidence === null || !extractionMethod) {
    return null;
  }
  return {
    eventParticipantId,
    eventId,
    sceneId,
    entityId,
    role,
    participantIndex,
    evidenceRefs: asStringArray(obj.evidence_refs),
    confidence,
    extractionMethod,
  };
}

function normalizeSceneIndex(raw: unknown): DebugSceneIndexRecord | null {
  const obj = asObject(raw);
  const sceneId = asString(obj.scene_id);
  const sceneIndex = asNumber(obj.scene_index);
  const headerRaw = asString(obj.header_raw) ?? '';
  const headerPrefix = asString(obj.header_prefix) ?? '';
  const locationRaw = asString(obj.location_raw) ?? '';
  const locationCanonicalId = asString(obj.location_canonical_id);
  const timeOfDay = asString(obj.time_of_day);
  const yearExplicit = asNumber(obj.year_explicit);
  const yearInferred = asNumber(obj.year_inferred);
  const eventCount = asNumber(obj.event_count) ?? 0;
  if (!sceneId || sceneIndex === null) return null;

  const eventRefsRaw = Array.isArray(obj.event_refs) ? obj.event_refs : [];
  const eventRefs = eventRefsRaw
    .map((r) => {
      const ro = asObject(r);
      const eventId = asString(ro.event_id);
      const eventTypeL1 = asString(ro.event_type_l1);
      const eventTypeL2 = asString(ro.event_type_l2);
      const sequenceInScene = asNumber(ro.sequence_in_scene);
      const summary = asString(ro.summary);
      if (!eventId || !eventTypeL1 || !eventTypeL2 || sequenceInScene === null || !summary) return null;
      return {
        eventId,
        eventTypeL1,
        eventTypeL2,
        sequenceInScene,
        summary,
        evidenceRefs: asStringArray(ro.evidence_refs),
      };
    })
    .filter((r): r is DebugSceneIndexRecord['eventRefs'][number] => r !== null);

  const l1CountsRaw = asObject(obj.event_type_l1_counts);
  const l2CountsRaw = asObject(obj.event_type_l2_counts);
  const toNumMap = (o: JsonObject): Record<string, number> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number')) as Record<string, number>;

  return {
    sceneId,
    sceneIndex,
    headerRaw,
    headerPrefix,
    locationRaw,
    locationCanonicalId,
    timeOfDay,
    yearExplicit,
    yearInferred,
    flags: asStringArray(obj.flags),
    lineStart: asNumber(obj.line_start),
    lineEnd: asNumber(obj.line_end),
    eventCount,
    eventTypeL1Counts: toNumMap(l1CountsRaw),
    eventTypeL2Counts: toNumMap(l2CountsRaw),
    participantEntityIds: asStringArray(obj.participant_entity_ids),
    eventRefs,
  };
}

function normalizeEntityLite(raw: unknown): DebugEntityLite | null {
  const obj = asObject(raw);
  const entityId = asString(obj.entity_id);
  const entityType = asString(obj.entity_type);
  const canonicalName = asString(obj.canonical_name);
  if (!entityId || !entityType || !canonicalName) return null;
  return { entityId, entityType, canonicalName };
}

async function loadTraceArtifactsUncached(): Promise<TraceArtifacts> {
  const [eventsEnv, participantsEnv, sceneIndexEnv, entitiesEnv] = await Promise.all([
    readEnvelope(EVENTS_PATH),
    readEnvelope(EVENT_PARTICIPANTS_PATH),
    readEnvelope(SCENE_INDEX_PATH),
    readEnvelope(ENTITIES_PATH),
  ]);

  const missingFiles: string[] = [];
  if (!eventsEnv) missingFiles.push('data/derived/events.json');
  if (!participantsEnv) missingFiles.push('data/derived/event_participants.json');
  if (!sceneIndexEnv) missingFiles.push('data/derived/scene_index.json');
  if (!entitiesEnv) missingFiles.push('data/derived/entities.json');

  if (!eventsEnv || !participantsEnv || !sceneIndexEnv || !entitiesEnv) {
    return {
      available: false,
      events: [],
      eventParticipants: [],
      sceneIndex: [],
      entities: [],
      eventById: new Map(),
      sceneById: new Map(),
      entityById: new Map(),
      metadata: { events: {}, eventParticipants: {}, sceneIndex: {} },
      missingFiles,
    };
  }

  const events = (eventsEnv.items ?? []).map(normalizeEvent).filter((x): x is DebugEventRecord => x !== null);
  const eventParticipants = (participantsEnv.items ?? [])
    .map(normalizeEventParticipant)
    .filter((x): x is DebugEventParticipantRecord => x !== null);
  const sceneIndex = (sceneIndexEnv.items ?? [])
    .map(normalizeSceneIndex)
    .filter((x): x is DebugSceneIndexRecord => x !== null)
    .sort((a, b) => a.sceneIndex - b.sceneIndex || a.sceneId.localeCompare(b.sceneId));
  const entities = (entitiesEnv.items ?? [])
    .map(normalizeEntityLite)
    .filter((x): x is DebugEntityLite => x !== null)
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  return {
    available: true,
    events,
    eventParticipants,
    sceneIndex,
    entities,
    eventById: new Map(events.map((e) => [e.eventId, e])),
    sceneById: new Map(sceneIndex.map((s) => [s.sceneId, s])),
    entityById: new Map(entities.map((e) => [e.entityId, e])),
    metadata: {
      events: asObject(eventsEnv.metadata),
      eventParticipants: asObject(participantsEnv.metadata),
      sceneIndex: asObject(sceneIndexEnv.metadata),
    },
    missingFiles: [],
  };
}

export async function loadTraceArtifacts(): Promise<TraceArtifacts> {
  if (!traceArtifactsCache) {
    traceArtifactsCache = loadTraceArtifactsUncached();
  }
  return traceArtifactsCache;
}

export function invalidateTraceArtifactsCache(): void {
  traceArtifactsCache = null;
}

export type TraceDebugFilters = {
  q?: string;
  eventType?: string;
  sceneId?: string;
  entityId?: string;
  l1?: string;
  limit?: number;
};

export async function listDebugEvents(filters: TraceDebugFilters = {}) {
  const artifacts = await loadTraceArtifacts();
  if (!artifacts.available) {
    return {
      available: false,
      items: [] as DebugEventRecord[],
      total: 0,
      filtered: 0,
      missingFiles: artifacts.missingFiles,
      sceneOptions: [] as DebugSceneIndexRecord[],
      entityOptions: [] as DebugEntityLite[],
      eventTypeOptions: [] as string[],
      l1Options: [] as string[],
      metadata: artifacts.metadata,
      entityById: new Map<string, DebugEntityLite>(),
      sceneById: new Map<string, DebugSceneIndexRecord>(),
    };
  }

  const q = (filters.q ?? '').trim().toLowerCase();
  const eventType = (filters.eventType ?? '').trim();
  const sceneId = (filters.sceneId ?? '').trim();
  const entityId = (filters.entityId ?? '').trim();
  const l1 = (filters.l1 ?? '').trim();
  const limit = Math.max(1, Math.min(filters.limit ?? 150, 500));

  const participantEventIds = entityId
    ? new Set(
        artifacts.eventParticipants
          .filter((p) => p.entityId === entityId)
          .map((p) => p.eventId),
      )
    : null;

  let rows = artifacts.events;
  if (eventType) rows = rows.filter((e) => e.eventTypeL2 === eventType);
  if (l1) rows = rows.filter((e) => e.eventTypeL1 === l1);
  if (sceneId) rows = rows.filter((e) => e.sceneId === sceneId);
  if (participantEventIds) rows = rows.filter((e) => participantEventIds.has(e.eventId));
  if (q) {
    rows = rows.filter((e) => {
      if (e.summary.toLowerCase().includes(q)) return true;
      if (e.eventId.toLowerCase().includes(q)) return true;
      if (e.eventTypeL2.toLowerCase().includes(q)) return true;
      const evidenceSpans = Array.isArray(e.metadata.evidence_spans) ? e.metadata.evidence_spans : [];
      return evidenceSpans.some((span) => {
        const s = asObject(span);
        const snippet = asString(s.snippet) ?? '';
        return snippet.toLowerCase().includes(q);
      });
    });
  }

  rows = [...rows].sort(
    (a, b) =>
      (artifacts.sceneById.get(a.sceneId)?.sceneIndex ?? Number.MAX_SAFE_INTEGER) -
        (artifacts.sceneById.get(b.sceneId)?.sceneIndex ?? Number.MAX_SAFE_INTEGER) ||
      a.sequenceInScene - b.sequenceInScene ||
      a.eventId.localeCompare(b.eventId),
  );

  const sceneOptions = artifacts.sceneIndex.filter((scene) => scene.eventCount > 0);
  const entityOptions = artifacts.entities.filter((entity) => entity.entityType !== 'location');
  const eventTypeOptions = [...new Set(artifacts.events.map((e) => e.eventTypeL2))].sort();
  const l1Options = [...new Set(artifacts.events.map((e) => e.eventTypeL1))].sort();

  return {
    available: true,
    items: rows.slice(0, limit),
    total: artifacts.events.length,
    filtered: rows.length,
    sceneOptions,
    entityOptions,
    eventTypeOptions,
    l1Options,
    metadata: artifacts.metadata,
    entityById: artifacts.entityById,
    sceneById: artifacts.sceneById,
  };
}

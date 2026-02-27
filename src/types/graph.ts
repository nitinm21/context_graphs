export type BuildStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

export interface ArtifactEnvelope<T> {
  metadata: Record<string, unknown>;
  items: T[];
}

export interface ArtifactBuildMetadata {
  schemaVersion: string;
  pipelineVersion: string;
  buildTimestamp: string;
  sourceFileHash: string;
}

export interface PhaseStatusCard {
  phase: number;
  label: string;
  status: BuildStatus;
  notes: string[];
}

export interface DatasetSummaryPlaceholder {
  source: string;
  scenes: number | null;
  utterances: number | null;
  actionBeats: number | null;
  events: number | null;
  parserVersion: string | null;
  lastBuildTimestamp: string | null;
  explicitSceneHeaders?: number | null;
  syntheticScenes?: number | null;
  parserWarnings?: string[];
  status:
    | 'pending_phase_1_parser'
    | 'partial_artifacts'
    | 'phase_1_parser_ready'
    | 'ready_for_queries';
}

export interface ParserBuildManifest {
  metadata: {
    parser_version?: string;
    build_timestamp?: string;
    source_file?: string;
    source_file_hash?: string;
    [key: string]: unknown;
  };
  summary: {
    scene_count_total?: number;
    scene_count_explicit_headers?: number;
    scene_count_synthetic?: number;
    utterance_count?: number;
    action_beat_count?: number;
    script_block_count?: number;
    parser_version?: string;
    [key: string]: unknown;
  };
}

export interface EvidenceRef {
  evidenceRefId: string;
  sourceFile: string;
  sceneId: string;
  blockType: 'utterance' | 'action' | 'scene_header' | 'unknown';
  blockId: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

export interface Scene {
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
  lineStart: number;
  lineEnd: number;
  sourceFile: string;
}

export interface Utterance {
  utteranceId: string;
  sceneId: string;
  speakerCueRaw: string;
  speakerEntityId: string | null;
  deliveryModifiers: string[];
  text: string;
  lineStart: number;
  lineEnd: number;
  sequenceInScene: number;
}

export interface ActionBeat {
  actionId: string;
  sceneId: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  sequenceInScene: number;
}

export interface Entity {
  entityId: string;
  entityType: 'character' | 'location' | 'organization' | 'group' | 'object';
  canonicalName: string;
  aliases: string[];
  firstSceneId: string | null;
  metadata: Record<string, unknown>;
}

export interface EntityAliasRecord {
  aliasRecordId: string;
  aliasRaw: string;
  aliasNormalized: string;
  entityId: string;
  entityType: Entity['entityType'];
  aliasKind: string;
  source: string;
  firstSceneId: string | null;
  count: number | null;
}

export interface KGEdge {
  edgeId: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  stability: 'stable' | 'semi_stable' | 'volatile';
  evidenceRefs: string[];
}

export interface KGEdgeRecord extends KGEdge {
  metadata?: Record<string, unknown>;
}

export interface KGNeighbor {
  direction: 'outgoing' | 'incoming';
  edge: KGEdgeRecord;
  neighbor: Entity | null;
}

export interface EventParticipant {
  entityId: string;
  role: string;
}

export interface Event {
  eventId: string;
  sceneId: string;
  eventTypeL1: string;
  eventTypeL2: string;
  summary: string;
  participants: EventParticipant[];
  evidenceRefs: string[];
  sequenceInScene: number;
  confidence: number;
  extractionMethod: 'rule' | 'llm' | 'rule+llm' | 'manual';
}

export interface TemporalEdge {
  temporalEdgeId: string;
  fromEventId: string;
  toEventId: string;
  relation:
    | 'precedes'
    | 'follows'
    | 'same_scene_next'
    | 'cross_scene_continuation'
    | 'flashback_to'
    | 'returns_to_frame';
  basis: string;
}

export interface StateChange {
  stateChangeId: string;
  subjectId: string;
  objectId: string;
  stateDimension: string;
  direction: 'increase' | 'decrease' | 'shift' | 'break' | 'repair_attempt' | 'stabilize';
  magnitude: 'low' | 'medium' | 'high' | null;
  sceneId: string;
  triggerEventIds: string[];
  evidenceRefs: string[];
  confidence: number;
  inferenceMethod: string;
  claimType: 'explicit' | 'inferred';
  metadata?: Record<string, unknown>;
}

export interface StructuredAnswer {
  answerText: string;
  modeUsed: 'kg' | 'ntg' | 'hybrid' | 'baseline_rag';
  queryType: string;
  confidence: number;
  eventsUsed: string[];
  entitiesUsed: string[];
  stateChangesUsed: string[];
  evidenceRefs: string[];
  reasoningNotes: string;
}

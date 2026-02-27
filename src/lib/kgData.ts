import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Entity, EntityAliasRecord, KGEdgeRecord, KGNeighbor } from '@/types/graph';

type JsonObject = Record<string, unknown>;

type RawEnvelope = {
  metadata?: JsonObject;
  items?: unknown[];
};

type KgArtifacts = {
  available: boolean;
  entities: Entity[];
  entityMap: Map<string, Entity>;
  aliases: EntityAliasRecord[];
  edges: KGEdgeRecord[];
  metadata: {
    entities: JsonObject;
    aliases: JsonObject;
    kgEdges: JsonObject;
  };
  missingFiles: string[];
};

const DERIVED_DIR = path.join(process.cwd(), 'data', 'derived');
const ENTITIES_PATH = path.join(DERIVED_DIR, 'entities.json');
const ALIASES_PATH = path.join(DERIVED_DIR, 'entity_aliases.json');
const KG_EDGES_PATH = path.join(DERIVED_DIR, 'kg_edges.json');

let artifactsCache: Promise<KgArtifacts> | null = null;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

async function readEnvelope(filePath: string): Promise<RawEnvelope | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const parsed = await readJson(filePath);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const env = parsed as RawEnvelope;
  if (!Array.isArray(env.items)) {
    return null;
  }
  return env;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function normalizeEntity(raw: unknown): Entity | null {
  const obj = asObject(raw);
  const entityId = asString(obj.entity_id);
  const entityType = asString(obj.entity_type);
  const canonicalName = asString(obj.canonical_name);
  if (!entityId || !entityType || !canonicalName) {
    return null;
  }
  if (!['character', 'location', 'organization', 'group', 'object'].includes(entityType)) {
    return null;
  }
  return {
    entityId,
    entityType: entityType as Entity['entityType'],
    canonicalName,
    aliases: asStringArray(obj.aliases),
    firstSceneId: asString(obj.first_scene_id),
    metadata: asObject(obj.metadata),
  };
}

function normalizeAlias(raw: unknown): EntityAliasRecord | null {
  const obj = asObject(raw);
  const aliasRecordId = asString(obj.alias_record_id);
  const aliasRaw = asString(obj.alias_raw);
  const aliasNormalized = asString(obj.alias_normalized);
  const entityId = asString(obj.entity_id);
  const entityType = asString(obj.entity_type);
  const aliasKind = asString(obj.alias_kind);
  const source = asString(obj.source);
  if (!aliasRecordId || !aliasRaw || !aliasNormalized || !entityId || !entityType || !aliasKind || !source) {
    return null;
  }
  if (!['character', 'location', 'organization', 'group', 'object'].includes(entityType)) {
    return null;
  }
  return {
    aliasRecordId,
    aliasRaw,
    aliasNormalized,
    entityId,
    entityType: entityType as Entity['entityType'],
    aliasKind,
    source,
    firstSceneId: asString(obj.first_scene_id),
    count: typeof obj.count === 'number' ? obj.count : null,
  };
}

function normalizeKgEdge(raw: unknown): KGEdgeRecord | null {
  const obj = asObject(raw);
  const edgeId = asString(obj.edge_id);
  const subjectId = asString(obj.subject_id);
  const predicate = asString(obj.predicate);
  const objectId = asString(obj.object_id);
  const stability = asString(obj.stability);
  if (!edgeId || !subjectId || !predicate || !objectId || !stability) {
    return null;
  }
  if (!['stable', 'semi_stable', 'volatile'].includes(stability)) {
    return null;
  }
  return {
    edgeId,
    subjectId,
    predicate,
    objectId,
    stability: stability as KGEdgeRecord['stability'],
    evidenceRefs: asStringArray(obj.evidence_refs),
    metadata: asObject(obj.metadata),
  };
}

async function loadKgArtifactsUncached(): Promise<KgArtifacts> {
  const [entitiesEnv, aliasesEnv, edgesEnv] = await Promise.all([
    readEnvelope(ENTITIES_PATH),
    readEnvelope(ALIASES_PATH),
    readEnvelope(KG_EDGES_PATH),
  ]);

  const missingFiles: string[] = [];
  if (!entitiesEnv) missingFiles.push('data/derived/entities.json');
  if (!aliasesEnv) missingFiles.push('data/derived/entity_aliases.json');
  if (!edgesEnv) missingFiles.push('data/derived/kg_edges.json');

  if (!entitiesEnv || !aliasesEnv || !edgesEnv) {
    return {
      available: false,
      entities: [],
      entityMap: new Map(),
      aliases: [],
      edges: [],
      metadata: { entities: {}, aliases: {}, kgEdges: {} },
      missingFiles,
    };
  }

  const entities = entitiesEnv.items?.map(normalizeEntity).filter((e): e is Entity => e !== null) ?? [];
  const aliases = aliasesEnv.items?.map(normalizeAlias).filter((e): e is EntityAliasRecord => e !== null) ?? [];
  const edges = edgesEnv.items?.map(normalizeKgEdge).filter((e): e is KGEdgeRecord => e !== null) ?? [];

  return {
    available: true,
    entities,
    entityMap: new Map(entities.map((entity) => [entity.entityId, entity])),
    aliases,
    edges,
    metadata: {
      entities: asObject(entitiesEnv.metadata),
      aliases: asObject(aliasesEnv.metadata),
      kgEdges: asObject(edgesEnv.metadata),
    },
    missingFiles: [],
  };
}

export function invalidateKgArtifactsCache(): void {
  artifactsCache = null;
}

export async function loadKgArtifacts(): Promise<KgArtifacts> {
  if (!artifactsCache) {
    artifactsCache = loadKgArtifactsUncached();
  }
  return artifactsCache;
}

export type ListEntitiesOptions = {
  q?: string;
  type?: Entity['entityType'] | 'all';
  limit?: number;
};

export async function listEntities(options: ListEntitiesOptions = {}): Promise<{
  available: boolean;
  items: Entity[];
  total: number;
  filtered: number;
  missingFiles?: string[];
}> {
  const artifacts = await loadKgArtifacts();
  if (!artifacts.available) {
    return { available: false, items: [], total: 0, filtered: 0, missingFiles: artifacts.missingFiles };
  }

  const q = (options.q ?? '').trim().toLowerCase();
  const type = options.type && options.type !== 'all' ? options.type : null;
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));

  let filtered = artifacts.entities;
  if (type) {
    filtered = filtered.filter((entity) => entity.entityType === type);
  }
  if (q) {
    filtered = filtered.filter((entity) => {
      if (entity.canonicalName.toLowerCase().includes(q)) return true;
      if (entity.entityId.toLowerCase().includes(q)) return true;
      return entity.aliases.some((alias) => alias.toLowerCase().includes(q));
    });
  }

  filtered = [...filtered].sort((a, b) => {
    if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
    return a.canonicalName.localeCompare(b.canonicalName);
  });

  return {
    available: true,
    items: filtered.slice(0, limit),
    total: artifacts.entities.length,
    filtered: filtered.length,
  };
}

export async function getEntityNeighbors(entityId: string): Promise<{
  available: boolean;
  entity: Entity | null;
  neighbors: KGNeighbor[];
  missingFiles?: string[];
}> {
  const artifacts = await loadKgArtifacts();
  if (!artifacts.available) {
    return { available: false, entity: null, neighbors: [], missingFiles: artifacts.missingFiles };
  }

  const entity = artifacts.entityMap.get(entityId) ?? null;
  if (!entity) {
    return { available: true, entity: null, neighbors: [] };
  }

  const neighbors: KGNeighbor[] = [];
  for (const edge of artifacts.edges) {
    if (edge.subjectId === entityId) {
      neighbors.push({
        direction: 'outgoing',
        edge,
        neighbor: artifacts.entityMap.get(edge.objectId) ?? null,
      });
    } else if (edge.objectId === entityId) {
      neighbors.push({
        direction: 'incoming',
        edge,
        neighbor: artifacts.entityMap.get(edge.subjectId) ?? null,
      });
    }
  }

  neighbors.sort((a, b) => {
    const an = a.neighbor?.canonicalName ?? a.edge.edgeId;
    const bn = b.neighbor?.canonicalName ?? b.edge.edgeId;
    if (an !== bn) return an.localeCompare(bn);
    if (a.edge.predicate !== b.edge.predicate) return a.edge.predicate.localeCompare(b.edge.predicate);
    return a.edge.edgeId.localeCompare(b.edge.edgeId);
  });

  return { available: true, entity, neighbors };
}

export async function getKgSummary(): Promise<{
  available: boolean;
  entityCount: number;
  edgeCount: number;
  predicateCounts: Record<string, number>;
  metadata?: KgArtifacts['metadata'];
  missingFiles?: string[];
}> {
  const artifacts = await loadKgArtifacts();
  if (!artifacts.available) {
    return {
      available: false,
      entityCount: 0,
      edgeCount: 0,
      predicateCounts: {},
      missingFiles: artifacts.missingFiles,
    };
  }

  const predicateCounts: Record<string, number> = {};
  for (const edge of artifacts.edges) {
    predicateCounts[edge.predicate] = (predicateCounts[edge.predicate] ?? 0) + 1;
  }

  return {
    available: true,
    entityCount: artifacts.entities.length,
    edgeCount: artifacts.edges.length,
    predicateCounts,
    metadata: artifacts.metadata,
  };
}

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ArtifactEnvelope, DatasetSummaryPlaceholder, ParserBuildManifest } from '@/types/graph';

type JsonObject = Record<string, unknown>;

const INTERMEDIATE_DIR = path.join(process.cwd(), 'data', 'intermediate');
const DERIVED_DIR = path.join(process.cwd(), 'data', 'derived');

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

async function readArtifactEnvelope(filePath: string): Promise<ArtifactEnvelope<unknown> | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const parsed = await readJson(filePath);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const maybe = parsed as Partial<ArtifactEnvelope<unknown>>;
  if (!Array.isArray(maybe.items)) {
    return null;
  }

  return {
    metadata: (maybe.metadata as JsonObject | undefined) ?? {},
    items: maybe.items,
  };
}

async function readCount(filePath: string): Promise<{ count: number | null; metadata: JsonObject }> {
  const envelope = await readArtifactEnvelope(filePath);
  if (!envelope) {
    return { count: null, metadata: {} };
  }

  return {
    count: envelope.items.length,
    metadata: envelope.metadata,
  };
}

async function readManifest(): Promise<ParserBuildManifest | null> {
  const manifestPath = path.join(INTERMEDIATE_DIR, 'parser_build_manifest.json');
  if (!(await fileExists(manifestPath))) {
    return null;
  }

  const parsed = await readJson(manifestPath);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const manifest = parsed as ParserBuildManifest;
  if (!manifest.metadata || typeof manifest.metadata !== 'object') {
    return null;
  }
  if (!manifest.summary || typeof manifest.summary !== 'object') {
    return null;
  }
  return manifest;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function getDatasetSummary(): Promise<DatasetSummaryPlaceholder> {
  const [scenes, utterances, actionBeats, events, manifest] = await Promise.all([
    readCount(path.join(INTERMEDIATE_DIR, 'scenes.json')),
    readCount(path.join(INTERMEDIATE_DIR, 'utterances.json')),
    readCount(path.join(INTERMEDIATE_DIR, 'action_beats.json')),
    readCount(path.join(DERIVED_DIR, 'events.json')),
    readManifest(),
  ]);

  const parserVersion =
    asNullableString(manifest?.metadata?.parser_version) ??
    asNullableString(scenes.metadata.parser_version) ??
    asNullableString(utterances.metadata.parser_version) ??
    null;

  const lastBuildTimestamp =
    asNullableString(manifest?.metadata?.build_timestamp) ??
    asNullableString(scenes.metadata.build_timestamp) ??
    null;

  const explicitSceneHeaders =
    asNullableNumber(manifest?.summary?.scene_count_explicit_headers) ??
    asNullableNumber(scenes.metadata.scene_count_explicit_headers) ??
    null;

  const syntheticScenes =
    asNullableNumber(manifest?.summary?.scene_count_synthetic) ??
    asNullableNumber(scenes.metadata.scene_count_synthetic) ??
    null;

  const parserWarnings: string[] = [];
  if ((syntheticScenes ?? 0) > 0 && (explicitSceneHeaders ?? 0) > 0) {
    parserWarnings.push(
      `${syntheticScenes} synthetic pre-header scene included; explicit scene headers parsed: ${explicitSceneHeaders}.`,
    );
  }

  const summary: DatasetSummaryPlaceholder = {
    source:
      asNullableString(manifest?.metadata?.source_file) ??
      asNullableString(scenes.metadata.source_file) ??
      'the-irishman-ampas-script-cleaned.md',
    scenes: scenes.count,
    utterances: utterances.count,
    actionBeats: actionBeats.count,
    events: events.count,
    parserVersion,
    lastBuildTimestamp,
    explicitSceneHeaders,
    syntheticScenes,
    parserWarnings: parserWarnings.length > 0 ? parserWarnings : undefined,
    status: 'pending_phase_1_parser',
  };

  const phase1Ready = [summary.scenes, summary.utterances, summary.actionBeats].every(
    (value) => typeof value === 'number',
  );

  if (phase1Ready) {
    summary.status = typeof summary.events === 'number' ? 'ready_for_queries' : 'phase_1_parser_ready';
  } else if ([summary.scenes, summary.utterances, summary.actionBeats].some((value) => value !== null)) {
    summary.status = 'partial_artifacts';
  }

  return summary;
}

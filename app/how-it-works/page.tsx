import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getDatasetSummary } from '@/lib/datasetSummary';

type JsonObject = Record<string, unknown>;

type CountArtifact = {
  count: number | null;
  metadata: JsonObject;
  samplePreview: string | null;
};

type StageCard = {
  title: string;
  purpose: string;
  outputs: string[];
  countLine: string;
  samplePreview: string | null;
};

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(text: string, max = 420): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function previewJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return null;
  }
}

async function readEnvelopeArtifact(relativePath: string): Promise<CountArtifact> {
  const filePath = path.join(process.cwd(), relativePath);
  const parsed = await readJson(filePath);
  if (!isObject(parsed)) {
    return { count: null, metadata: {}, samplePreview: null };
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const metadata = isObject(parsed.metadata) ? parsed.metadata : {};
  const samplePreview = items.length > 0 ? previewJson(items[0]) : null;
  return {
    count: items.length,
    metadata,
    samplePreview,
  };
}

function asRecord(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export default async function HowItWorksPage() {
  const [
    datasetSummary,
    entities,
    aliases,
    kgEdges,
    events,
    temporalEdges,
    stateChanges,
    parserQualityRaw,
    taxonomyCoverageRaw,
    queryExamplesRaw,
    parserManifestRaw,
  ] = await Promise.all([
    getDatasetSummary(),
    readEnvelopeArtifact('data/derived/entities.json'),
    readEnvelopeArtifact('data/derived/entity_aliases.json'),
    readEnvelopeArtifact('data/derived/kg_edges.json'),
    readEnvelopeArtifact('data/derived/events.json'),
    readEnvelopeArtifact('data/derived/temporal_edges.json'),
    readEnvelopeArtifact('data/derived/state_changes.json'),
    readJson(path.join(process.cwd(), 'data/eval/parser_quality_report.json')),
    readJson(path.join(process.cwd(), 'data/eval/taxonomy_coverage_report.json')),
    readJson(path.join(process.cwd(), 'data/derived/query_examples.json')),
    readJson(path.join(process.cwd(), 'data/intermediate/parser_build_manifest.json')),
  ]);

  const parserQuality = asRecord(parserQualityRaw);
  const parserQualitySummary = asRecord(parserQuality.summary);
  const taxonomyCoverage = asRecord(taxonomyCoverageRaw);
  const taxonomySummary = asRecord(taxonomyCoverage.summary);
  const queryExamples = asRecord(queryExamplesRaw);
  const queryExamplesMeta = asRecord(queryExamples.metadata);
  const parserManifest = asRecord(parserManifestRaw);
  const parserManifestSummary = asRecord(parserManifest.summary);

  const parserGatePassed = asBoolean(parserQualitySummary.release_gate_passed);
  const taxonomyUnknownCount = asNumber(taxonomySummary.unknown_event_type_count);
  const taxonomyUnmappedRequiredCount = asNumber(taxonomySummary.unmapped_review_required_count);

  const stageCards: StageCard[] = [
    {
      title: '1. Parse Screenplay',
      purpose: 'Deterministically split the cleaned screenplay into scenes, utterances, action beats, and ordered script blocks.',
      outputs: [
        'data/intermediate/scenes.json',
        'data/intermediate/utterances.json',
        'data/intermediate/action_beats.json',
        'data/intermediate/script_blocks.json',
      ],
      countLine: `Scenes ${datasetSummary.scenes ?? '—'} · Utterances ${datasetSummary.utterances ?? '—'} · Action beats ${
        datasetSummary.actionBeats ?? '—'
      }`,
      samplePreview: previewJson(parserManifestSummary),
    },
    {
      title: '2. Canonicalize Entities + Aliases',
      purpose: 'Build canonical entities and alias maps so user questions and screenplay variants resolve to stable IDs.',
      outputs: ['data/derived/entities.json', 'data/derived/entity_aliases.json', 'data/derived/kg_edges.json'],
      countLine: `Entities ${entities.count ?? '—'} · Aliases ${aliases.count ?? '—'} · KG edges ${kgEdges.count ?? '—'}`,
      samplePreview: entities.samplePreview,
    },
    {
      title: '3. Extract Events (Taxonomy)',
      purpose: 'Classify utterances/actions into typed narrative events using a fixed taxonomy and deterministic rules.',
      outputs: ['data/derived/events.json', 'data/derived/event_participants.json', 'config/event_taxonomy.json'],
      countLine: `Events ${events.count ?? datasetSummary.events ?? '—'} · Observed L2 ${
        asNumber(taxonomySummary.observed_l2_count) ?? '—'
      } / Taxonomy L2 ${asNumber(taxonomySummary.taxonomy_l2_count) ?? '—'}`,
      samplePreview: events.samplePreview,
    },
    {
      title: '4. Build Temporal Edges',
      purpose: 'Link events in narrative order and preserve scene transitions so chronology and flashback structure can be queried.',
      outputs: ['data/derived/temporal_edges.json'],
      countLine: `Temporal edges ${temporalEdges.count ?? '—'}`,
      samplePreview: temporalEdges.samplePreview,
    },
    {
      title: '5. Infer State Changes',
      purpose: 'Infer explicit vs heuristic relationship-state changes (for example distance/trust shifts) from events and rules.',
      outputs: ['data/derived/state_changes.json', 'config/state_change_rules.json'],
      countLine: `State changes ${stateChanges.count ?? '—'}`,
      samplePreview: stateChanges.samplePreview,
    },
    {
      title: '6. Query Routing + Answer Builders',
      purpose: 'Classify questions and route to KG / NCG / hybrid answer builders with structured evidence references.',
      outputs: ['/api/query', '/api/query/baseline-rag', 'data/derived/query_examples.json'],
      countLine: `Curated benchmark fixtures ${asNumber(queryExamplesMeta.record_count) ?? '—'}`,
      samplePreview: previewJson(Array.isArray(queryExamples.items) ? queryExamples.items[0] : null),
    },
  ];

  return (
    <main id="main-content">
      <section className="hero how-hero" aria-labelledby="how-it-works-title">
        <div className="how-hero-grid">
          <div className="how-hero-heading">
            <p className="eyebrow">How It Works</p>
            <h1 id="how-it-works-title">How was the data engineering pipeline built?</h1>
          </div>
          <div className="how-hero-main">
            <p className="subtitle">
              This page translates the pipeline into a clear narrative: parse the screenplay, build graph artifacts, extract
              narrative structure, and validate outputs with quality gates before serving answers.
            </p>
          </div>
        </div>
      </section>

      <section className="grid how-it-works-gates" style={{ marginTop: '1rem' }} aria-label="Quality gates">
        <article className="card">
          <h2>{parserGatePassed ? 'Release Gate Passed' : 'Needs Review'}</h2>
          <dl className="kv">
            <dt>Checks Passed</dt>
            <dd>
              {(asNumber(parserQualitySummary.passed_checks) ?? '—').toString()} /{' '}
              {(asNumber(parserQualitySummary.total_checks) ?? '—').toString()}
            </dd>
            <dt>Explicit Scene Headers</dt>
            <dd>{asNumber(parserQualitySummary.explicit_scene_header_count_actual) ?? '—'}</dd>
            <dt>Total Scenes</dt>
            <dd>{asNumber(parserQualitySummary.scene_count_total) ?? '—'}</dd>
          </dl>
        </article>

        <article className="card">
          <h2>
            {taxonomyUnknownCount === 0 && taxonomyUnmappedRequiredCount === 0 ? 'Release Gate Passed' : 'Coverage Review Needed'}
          </h2>
          <dl className="kv">
            <dt>Total Events</dt>
            <dd>{asNumber(taxonomySummary.total_events) ?? '—'}</dd>
            <dt>Unknown Event Types</dt>
            <dd>{taxonomyUnknownCount ?? '—'}</dd>
            <dt>Unmapped Review Required</dt>
            <dd>{taxonomyUnmappedRequiredCount ?? '—'}</dd>
          </dl>
        </article>

      </section>

      <section style={{ marginTop: '1rem' }} className="pipeline-stage-grid" aria-label="Pipeline stages">
        {stageCards.map((stage) => (
          <article key={stage.title} className="card pipeline-stage-card">
            <div className="pipeline-stage-header">
              <h2>{stage.title}</h2>
              <span className="pill">{stage.countLine}</span>
            </div>
            <p className="muted">
              {stage.purpose}
              {stage.title === '1. Parse Screenplay' ? (
                <>
                  {' '}
                  <a
                    href="https://deadline.com/wp-content/uploads/2019/12/the-irishman-ampas-script.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Here
                  </a>{' '}
                  is the original script.
                </>
              ) : null}
            </p>
            <div className="pipeline-stage-outputs">
              {stage.outputs.map((output) => (
                <code key={output} className="mono">
                  {output}
                </code>
              ))}
            </div>
            {stage.samplePreview ? (
              <details className="pipeline-sample">
                <summary>Show sample artifact snippet</summary>
                <pre>{stage.samplePreview}</pre>
              </details>
            ) : null}
          </article>
        ))}
      </section>

    </main>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { ApiQueryResponse } from '@/lib/queryContract';

type EvidenceLookupItem = {
  kind: 'event' | 'state_change' | 'scene_ref' | 'raw_ref' | string;
  id: string;
  scene_id: string | null;
  scene_header: string | null;
  title: string;
  snippet: string | null;
  trace_href: string | null;
  timeline_href: string | null;
  claim_type?: string;
  tags?: string[];
};

type EvidenceLookupResponse = {
  available?: boolean;
  items?: EvidenceLookupItem[];
  unresolved_refs?: string[];
  missing_files?: string[];
  error?: string;
};

type AskVisualCanvasProps = {
  response: ApiQueryResponse | null;
  isLoading?: boolean;
};

function hasWork(response: ApiQueryResponse | null): boolean {
  return Boolean(response && (response.events_used.length || response.state_changes_used.length || response.evidence_refs.length));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function sceneOrder(sceneId: string | null): number {
  if (!sceneId) return Number.MAX_SAFE_INTEGER;
  const m = sceneId.match(/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function primaryItems(items: EvidenceLookupItem[]): EvidenceLookupItem[] {
  return [...items].sort((a, b) => sceneOrder(a.scene_id) - sceneOrder(b.scene_id)).slice(0, 12);
}

export default function AskVisualCanvas({ response, isLoading = false }: AskVisualCanvasProps) {
  const [lookup, setLookup] = useState<EvidenceLookupResponse | null>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [selectedKind, setSelectedKind] = useState<string>('all');
  const [selectedScene, setSelectedScene] = useState<string>('all');

  useEffect(() => {
    if (!hasWork(response)) {
      setLookup(null);
      setLoadingLookup(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoadingLookup(true);

    fetch('/api/query/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events_used: response?.events_used ?? [],
        state_changes_used: response?.state_changes_used ?? [],
        evidence_refs: response?.evidence_refs ?? [],
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = (await res.json()) as EvidenceLookupResponse;
        if (!active) return;
        setLookup(json);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLookup({ error: message });
      })
      .finally(() => {
        if (active) setLoadingLookup(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [response]);

  useEffect(() => {
    setSelectedKind('all');
    setSelectedScene('all');
  }, [response?.question]);

  const items = useMemo(() => primaryItems(lookup?.items ?? []), [lookup?.items]);
  const confidencePct = clampPercent(response?.confidence ?? 0);

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const sceneOptions = useMemo(() => {
    const scenes = [...new Set(items.map((item) => item.scene_id).filter((s): s is string => Boolean(s)))];
    return scenes.sort((a, b) => sceneOrder(a) - sceneOrder(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedKind !== 'all' && item.kind !== selectedKind) return false;
      if (selectedScene !== 'all' && item.scene_id !== selectedScene) return false;
      return true;
    });
  }, [items, selectedKind, selectedScene]);

  const storyboardItems = filteredItems.slice(0, 6);

  return (
    <section className="card ask-visual-shell" aria-labelledby="ask-visual-title">
      <div className="ask-visual-top">
        <div>
          <p className="eyebrow" style={{ marginBottom: '0.3rem' }}>
            Evidence Explorer
          </p>
          <h2 id="ask-visual-title" style={{ marginBottom: '0.3rem' }}>
            Storyboard + technical traces in one place
          </h2>
        </div>
        {response ? (
          <div className="ask-visual-badges">
            <span className="pill">type: {response.query_type.replaceAll('_', ' ')}</span>
            <span className="pill">mode: {response.mode_used}</span>
            <span className="pill">confidence: {confidencePct}%</span>
          </div>
        ) : null}
      </div>

      {!response ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Ask a question to generate a visual story of entities, timeline steps, and evidence.
        </p>
      ) : (
        <>
          <section className="ask-snapshot-grid" aria-label="Answer snapshot">
            <article className="ask-snapshot-card">
              <p className="muted">Entities</p>
              <strong>{response.entities_used.length}</strong>
            </article>
            <article className="ask-snapshot-card">
              <p className="muted">Events</p>
              <strong>{response.events_used.length}</strong>
            </article>
            <article className="ask-snapshot-card">
              <p className="muted">State Changes</p>
              <strong>{response.state_changes_used.length}</strong>
            </article>
            <article className="ask-snapshot-card">
              <p className="muted">Evidence Refs</p>
              <strong>{response.evidence_refs.length}</strong>
            </article>
          </section>

          <section className="ask-visual-controls" aria-label="Visual controls">
            <div className="ask-control-group">
              <button
                type="button"
                className={`pill as-button ${selectedKind === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedKind('all')}
              >
                all kinds
              </button>
              {kindCounts.map(([kind, count]) => (
                <button
                  key={kind}
                  type="button"
                  className={`pill as-button ${selectedKind === kind ? 'active' : ''}`}
                  onClick={() => setSelectedKind(kind)}
                >
                  {kind.replaceAll('_', ' ')} ({count})
                </button>
              ))}
            </div>
            <label className="field ask-scene-filter">
              <span>Scene filter</span>
              <select value={selectedScene} onChange={(event) => setSelectedScene(event.target.value)}>
                <option value="all">All scenes</option>
                {sceneOptions.map((sceneId) => (
                  <option key={sceneId} value={sceneId}>
                    {sceneId}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section aria-label="Evidence storyboard">
            <div className="ask-storyboard-top">
              <h3>Evidence storyboard</h3>
              {(loadingLookup || isLoading) && <span className="muted">Loading visual rows…</span>}
            </div>
            {lookup?.error ? <p className="muted">Visual lookup error: {lookup.error}</p> : null}
            <div className="ask-storyboard-grid">
              {storyboardItems.map((item) => (
                <article key={`${item.kind}:${item.id}`} className="ask-story-card">
                  <div className="ask-story-card-top">
                    <span className="pill">{item.kind.replaceAll('_', ' ')}</span>
                    <span className="mono muted">{item.scene_id ?? item.id}</span>
                  </div>
                  <strong>{item.title}</strong>
                  {item.snippet ? <p className="muted">{item.snippet}</p> : null}
                  <div className="pill-row">
                    {item.trace_href ? (
                      <Link href={item.trace_href} className="button secondary" target="_blank" rel="noopener noreferrer">
                        Open Trace
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))}
              {!storyboardItems.length ? (
                <article className="ask-story-card">
                  <strong>Nothing matches current filters</strong>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Reset kind/scene filters or ask a more specific question.
                  </p>
                </article>
              ) : null}
            </div>
          </section>

          <details className="card ask-evidence-details" style={{ padding: '0.75rem' }}>
            <summary className="ask-evidence-details-summary">
              <span>Technical detail rows</span>
              <span className="muted">expand for full trace/snippet list ({filteredItems.length})</span>
            </summary>
            <div style={{ marginTop: '0.75rem' }}>
              {lookup?.available === false && lookup?.missing_files?.length ? (
                <ul className="list">
                  {lookup.missing_files.map((file) => (
                    <li key={file}>
                      Missing artifact: <span className="mono">{file}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="evidence-list" role="list">
                {filteredItems.map((item) => (
                  <article key={`${item.kind}:${item.id}`} role="listitem" className="evidence-item">
                    <div className="evidence-item-top">
                      <span className={`badge evidence-kind kind-${item.kind}`}>{item.kind.replaceAll('_', ' ')}</span>
                      <span className="mono muted">{item.id}</span>
                    </div>
                    <div className="evidence-item-title">{item.title}</div>
                    {item.scene_header ? (
                      <div className="muted evidence-scene">
                        {item.scene_id ? <span className="mono">{item.scene_id}</span> : null}
                        {item.scene_id ? ' | ' : ''}
                        {item.scene_header}
                      </div>
                    ) : null}
                    {item.snippet ? <p className="evidence-snippet">{item.snippet}</p> : null}
                    {item.tags?.length ? (
                      <div className="pill-row" style={{ marginTop: '0.4rem' }}>
                        {item.tags.slice(0, 5).map((tag) => (
                          <span key={`${item.id}-${tag}`} className="pill">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="evidence-links">
                      {item.trace_href ? (
                        <Link href={item.trace_href} className="button secondary" target="_blank" rel="noopener noreferrer">
                          Open Trace
                        </Link>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              {lookup?.unresolved_refs?.length ? (
                <details className="card" style={{ marginTop: '0.8rem', padding: '0.75rem' }}>
                  <summary className="mono" style={{ cursor: 'pointer' }}>
                    Unresolved raw evidence refs ({lookup.unresolved_refs.length})
                  </summary>
                  <ul className="list mono" style={{ marginTop: '0.5rem' }}>
                    {lookup.unresolved_refs.slice(0, 20).map((ref) => (
                      <li key={ref}>{ref}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

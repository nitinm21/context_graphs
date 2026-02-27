'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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

type EvidencePanelProps = {
  response: ApiQueryResponse | null;
};

function hasWork(response: ApiQueryResponse | null): boolean {
  return Boolean(
    response &&
      (response.events_used.length > 0 || response.state_changes_used.length > 0 || response.evidence_refs.length > 0),
  );
}

export default function EvidencePanel({ response }: EvidencePanelProps) {
  const [lookup, setLookup] = useState<EvidenceLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hasWork(response)) {
      setLookup(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);

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
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [response]);

  return (
    <section className="card evidence-shell" aria-labelledby="evidence-title">
      <div className="evidence-header">
        <div>
          <p className="eyebrow" style={{ marginBottom: '0.35rem' }}>
            Evidence
          </p>
          <h2 id="evidence-title" style={{ marginBottom: '0.25rem' }}>
            Clickable scene traces and snippets
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            "Trace" opens a guided review view for the cited scene/event first. "Timeline" is the deeper audit view for scene-ordered inspection.
          </p>
        </div>
        {response ? (
          <div className="evidence-counts mono">
            evts {response.events_used.length} | sc {response.state_changes_used.length} | refs {response.evidence_refs.length}
          </div>
        ) : null}
      </div>

      {!response ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Run a query to populate evidence rows.
        </p>
      ) : !hasWork(response) ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          This answer did not cite trace rows or evidence refs (common for some KG-only fact responses or when evidence refs are disabled).
        </p>
      ) : (
        <>
          {loading ? <p className="muted">Loading evidence context…</p> : null}
          {lookup?.error ? <p className="muted">Evidence lookup error: {lookup.error}</p> : null}
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
            {(lookup?.items ?? []).map((item) => (
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
                    <Link href={item.trace_href} className="button secondary">
                      {item.kind === 'event'
                        ? 'Review Event in Trace'
                        : item.kind === 'state_change'
                          ? 'Review State Change in Trace'
                          : item.kind === 'scene_ref'
                            ? 'Review Scene in Trace'
                            : 'Open Trace Review'}
                    </Link>
                  ) : null}
                  {item.timeline_href ? (
                    <Link href={item.timeline_href} className="button secondary">
                      Open Timeline Audit
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
        </>
      )}
    </section>
  );
}

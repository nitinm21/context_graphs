'use client';

import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';

import AnswerPanel from '@/components/AnswerPanel';
import AskVisualCanvas from '@/components/AskVisualCanvas';
import BaselineComparisonPanel from '@/components/BaselineComparisonPanel';
import EvidencePanel from '@/components/EvidencePanel';
import QuestionInput, { type PresetQuestion } from '@/components/QuestionInput';
import { type ApiQueryResponse, type PreferredMode, validateApiQueryResponse } from '@/lib/queryContract';
import { routeQuery } from '@/lib/queryRouter';

type BenchmarkFixture = {
  query_id: string;
  question: string;
  query_type_expected: string;
  mode_expected: string;
  category?: string;
  include_baseline_comparison?: boolean;
  notes?: string;
};

type QueryWorkbenchProps = {
  presets?: PresetQuestion[];
  fixtures?: BenchmarkFixture[];
  initialQuestion?: string;
  initialIncludeBaselineComparison?: boolean;
  autoRunInitial?: boolean;
  shellTitle?: string;
  shellSubtitle?: string;
  layoutVariant?: 'default' | 'focus';
  showFocusHelper?: boolean;
  inputVariant?: 'full' | 'simple' | 'compare';
  compactStructuredAnswer?: boolean;
  forceBaselineComparison?: boolean;
  showEvidencePanel?: boolean;
  submitLabel?: string;
  advancedOptionsOpenByDefault?: boolean;
  showVisualCanvas?: boolean;
  showAdvancedOptions?: boolean;
};

type QueryRunState = {
  question: string;
  preferred_mode: PreferredMode;
  include_evidence: boolean;
  include_baseline_comparison: boolean;
};

export type { BenchmarkFixture };

function normalizeFixtures(input: BenchmarkFixture[] | undefined): BenchmarkFixture[] {
  if (!input) return [];
  return [...input].sort((a, b) => a.query_id.localeCompare(b.query_id));
}

export default function QueryWorkbench({
  presets = [],
  fixtures,
  initialQuestion = "How does Peggy's relationship with Frank change over time?",
  initialIncludeBaselineComparison = false,
  autoRunInitial = false,
  shellTitle,
  shellSubtitle,
  layoutVariant = 'default',
  showFocusHelper = true,
  inputVariant = 'full',
  compactStructuredAnswer = false,
  forceBaselineComparison = false,
  showEvidencePanel = true,
  submitLabel,
  advancedOptionsOpenByDefault = false,
  showVisualCanvas = false,
  showAdvancedOptions = true,
}: QueryWorkbenchProps) {
  const isFocusLayout = layoutVariant === 'focus';
  const normalizedFixtures = normalizeFixtures(fixtures);
  const [question, setQuestion] = useState(initialQuestion);
  const [preferredMode, setPreferredMode] = useState<PreferredMode>('auto');
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [includeBaselineComparison, setIncludeBaselineComparison] = useState(initialIncludeBaselineComparison);
  const [response, setResponse] = useState<ApiQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastRun, setLastRun] = useState<QueryRunState | null>(null);
  const [fixturesFilter, setFixturesFilter] = useState('');
  const deferredQuestion = useDeferredValue(question);
  const deferredFixturesFilter = useDeferredValue(fixturesFilter);
  const effectiveIncludeBaselineComparison = forceBaselineComparison ? true : includeBaselineComparison;
  const hasAskedQuestion = Boolean(lastRun) || isSubmitting;

  const routePreview = deferredQuestion.trim()
    ? routeQuery(deferredQuestion, { preferredMode, entityCount: 0 })
    : null;

  const filteredFixtures = normalizedFixtures.filter((fixture) => {
    if (!deferredFixturesFilter.trim()) return true;
    const q = deferredFixturesFilter.trim().toLowerCase();
    return (
      fixture.query_id.toLowerCase().includes(q) ||
      fixture.question.toLowerCase().includes(q) ||
      (fixture.category ?? '').toLowerCase().includes(q) ||
      fixture.query_type_expected.toLowerCase().includes(q)
    );
  });

  async function runQuery(next: QueryRunState) {
    const lockedNext: QueryRunState = forceBaselineComparison ? { ...next, include_baseline_comparison: true } : next;
    setIsSubmitting(true);
    setError(null);
    setLastRun(lockedNext);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(lockedNext),
      });
      const payload = (await res.json()) as unknown;
      if (!res.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
            ? ((payload as { error: string }).error)
            : `Request failed (${res.status})`;
        throw new Error(message);
      }
      const validation = validateApiQueryResponse(payload);
      if (!validation.ok) {
        throw new Error(`Query API contract error: ${validation.error}`);
      }
      setResponse(payload as ApiQueryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  }

  function submitCurrent() {
    void runQuery({
      question,
      preferred_mode: preferredMode,
      include_evidence: includeEvidence,
      include_baseline_comparison: effectiveIncludeBaselineComparison,
    });
  }

  function applyPreset(preset: PresetQuestion) {
    startTransition(() => {
      setQuestion(preset.question);
      if (typeof preset.includeEvidence === 'boolean') setIncludeEvidence(preset.includeEvidence);
      if (!forceBaselineComparison && typeof preset.includeBaselineComparison === 'boolean') {
        setIncludeBaselineComparison(preset.includeBaselineComparison);
      }
    });
  }

  function runFixture(fixture: BenchmarkFixture) {
    const includeBaseline = forceBaselineComparison ? true : Boolean(fixture.include_baseline_comparison);
    startTransition(() => {
      setQuestion(fixture.question);
      setPreferredMode('auto');
      setIncludeEvidence(true);
      if (!forceBaselineComparison) setIncludeBaselineComparison(includeBaseline);
    });
    void runQuery({
      question: fixture.question,
      preferred_mode: 'auto',
      include_evidence: true,
      include_baseline_comparison: includeBaseline,
    });
  }

  function handleBaselineToggle(next: boolean) {
    if (forceBaselineComparison) return;
    setIncludeBaselineComparison(next);
    if (!lastRun) return;
    if (!response) return;
    if (lastRun.question !== question) return;
    if (lastRun.include_baseline_comparison === next) return;
    void runQuery({ ...lastRun, include_baseline_comparison: next });
  }

  useEffect(() => {
    if (!autoRunInitial) return;
    if (response || error || isSubmitting || lastRun) return;
    void runQuery({
      question: initialQuestion,
      preferred_mode: preferredMode,
      include_evidence: includeEvidence,
      include_baseline_comparison: includeBaselineComparison,
    });
  }, [
    autoRunInitial,
    error,
    includeBaselineComparison,
    includeEvidence,
    initialQuestion,
    isSubmitting,
    lastRun,
    preferredMode,
    response,
  ]);

  return (
    <section className="query-workbench">
      {shellTitle || shellSubtitle ? (
        <section className="card query-shell-intro">
          {shellTitle ? <h2 style={{ marginBottom: '0.35rem' }}>{shellTitle}</h2> : null}
          {shellSubtitle ? (
            <p className="muted" style={{ margin: 0 }}>
              {shellSubtitle}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className={`query-main-grid${isFocusLayout ? ' focus' : ''}`}>
        <div className="query-main-column">
          <QuestionInput
            question={question}
            preferredMode={preferredMode}
            includeEvidence={includeEvidence}
            includeBaselineComparison={effectiveIncludeBaselineComparison}
            isSubmitting={isSubmitting}
            routePreview={routePreview}
            onQuestionChange={setQuestion}
            onPreferredModeChange={setPreferredMode}
            onIncludeEvidenceChange={setIncludeEvidence}
            onIncludeBaselineComparisonChange={handleBaselineToggle}
            onSubmit={submitCurrent}
            presets={presets}
            onPresetSelect={applyPreset}
            submitLabel={submitLabel}
            variant={inputVariant}
            advancedOpenByDefault={advancedOptionsOpenByDefault}
            lockBaselineComparison={forceBaselineComparison}
            showAdvancedOptions={showAdvancedOptions}
          />

          {error ? (
            <section className="card" aria-live="polite">
              <h2>Query Error</h2>
              <p className="muted" style={{ marginBottom: 0 }}>
                {error}
              </p>
            </section>
          ) : null}

          {hasAskedQuestion ? (
            <>
              {showVisualCanvas ? <AskVisualCanvas response={response} isLoading={isSubmitting} /> : null}

              <AnswerPanel
                answer={response}
                question={response?.question}
                compact={compactStructuredAnswer}
                emptyMessage="Run a question to view the deterministic answer contract."
              />

              <BaselineComparisonPanel response={response} enabled={effectiveIncludeBaselineComparison} isLoading={isSubmitting} />

              {showEvidencePanel ? <EvidencePanel response={response} /> : null}
            </>
          ) : null}
        </div>

        {!isFocusLayout ? (
          <aside className="query-side-column">
            <section className="card">
              <h2>Demo Flow</h2>
              <ol className="list">
                <li>Ask the Peggy/Frank relationship question.</li>
                <li>Inspect the NCG mode badge and router rationale.</li>
                <li>Open evidence rows in `/trace` or `/timeline`.</li>
                <li>Toggle baseline comparison and compare structural differences.</li>
              </ol>
            </section>

            <section className="card">
              <h2>Explorer Shortcuts</h2>
              <div className="explorer-link-grid">
                <Link href="/kg" className="explorer-link-card">
                  <strong>KG</strong>
                  <span>Entity neighborhoods and edge labels</span>
                </Link>
                <Link href="/trace" className="explorer-link-card">
                  <strong>NCG Trace</strong>
                  <span>Event nodes, temporal edges, state overlays</span>
                </Link>
                <Link href="/timeline" className="explorer-link-card">
                  <strong>Timeline</strong>
                  <span>Scene-ordered inspection with script blocks</span>
                </Link>
                <Link href="/about" className="explorer-link-card">
                  <strong>About</strong>
                  <span>Methodology, limits, and copyright notes</span>
                </Link>
              </div>
            </section>

            {normalizedFixtures.length ? (
              <section className="card benchmark-rail" aria-labelledby="bench-rail-title">
                <div className="benchmark-rail-header">
                  <h2 id="bench-rail-title">Benchmark Fixtures</h2>
                  <Link href="/benchmarks" className="button secondary">
                    Full Benchmarks
                  </Link>
                </div>
                <label className="field">
                  <span>Filter fixtures</span>
                  <input
                    value={fixturesFilter}
                    onChange={(event) => setFixturesFilter(event.target.value)}
                    placeholder="type, category, query id"
                  />
                </label>
                <div className="benchmark-fixture-list">
                  {filteredFixtures.slice(0, 8).map((fixture) => (
                    <button key={fixture.query_id} type="button" className="fixture-item" onClick={() => runFixture(fixture)}>
                      <div className="fixture-top mono">{fixture.query_id}</div>
                      <div className="fixture-q">{fixture.question}</div>
                      <div className="fixture-meta">
                        <span className="pill">{fixture.query_type_expected}</span>
                        <span className="pill">{fixture.mode_expected}</span>
                        {fixture.include_baseline_comparison ? <span className="pill">baseline on</span> : null}
                      </div>
                    </button>
                  ))}
                  {filteredFixtures.length === 0 ? <p className="muted">No fixtures match that filter.</p> : null}
                </div>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>

      {isFocusLayout && showFocusHelper ? (
        <details className="card query-focus-helper" style={{ marginTop: '0.25rem' }}>
          <summary className="query-focus-helper-summary">
            <span>Optional demo helpers</span>
            <span className="muted">flow + benchmarks + docs</span>
          </summary>
          <div className="query-focus-helper-body">
            <div className="query-focus-helper-grid">
              <section>
                <h2>Suggested demo flow</h2>
                <ol className="list">
                  <li>Ask the Peggy/Frank relationship question.</li>
                  <li>Inspect the route choice and router rationale.</li>
                  <li>Open cited evidence rows in `/trace` or `/timeline`.</li>
                  <li>Toggle baseline comparison and compare structure.</li>
                </ol>
              </section>
              <section>
                <h2>Next places to go</h2>
                <div className="pill-row" style={{ marginTop: '0.35rem' }}>
                  <Link href="/benchmarks" className="button secondary">
                    Full Benchmarks
                  </Link>
                  <Link href="/about" className="button secondary">
                    About / Method
                  </Link>
                  <Link href="/timeline" className="button secondary">
                    Timeline Audit
                  </Link>
                </div>
                {normalizedFixtures.length ? (
                  <>
                    <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.35rem' }}>
                      Quick fixtures (run immediately):
                    </p>
                    <div className="benchmark-fixture-list compact">
                      {normalizedFixtures.slice(0, 3).map((fixture) => (
                        <button key={fixture.query_id} type="button" className="fixture-item" onClick={() => runFixture(fixture)}>
                          <div className="fixture-top mono">{fixture.query_id}</div>
                          <div className="fixture-q">{fixture.question}</div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

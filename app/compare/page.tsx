import Link from 'next/link';

import QueryWorkbench from '@/components/QueryWorkbench';

const COMPARE_PRESETS = [
  {
    label: 'Peggy <> Frank arc',
    question: "How does Peggy's relationship with Frank change over time?",
    includeBaselineComparison: true,
  },
  {
    label: 'Hoffa disappearance chain',
    question: "What events lead up to Hoffa's disappearance in the story?",
    includeBaselineComparison: true,
  },
  {
    label: 'Why not just RAG?',
    question: "Why is this not just RAG for Peggy and Frank's relationship arc?",
    includeBaselineComparison: true,
  },
  {
    label: 'Frank <> Hoffa comparison',
    question: 'Compare KG and timeline answers for Jimmy Hoffa and Frank.',
    includeBaselineComparison: true,
  },
] as const;

export default function ComparePage() {
  return (
    <main id="main-content">
      <section className="hero hero-flow" aria-labelledby="compare-title">
        <div className="hero-flow-main">
          <p className="eyebrow">Compare</p>
          <h1 id="compare-title">Show why graph reasoning is different from retrieval-style answers.</h1>
          <p className="subtitle">
            Run the same question through the deterministic graph pipeline and a retrieval-style baseline. This is the fastest way
            to explain <strong>KG</strong> vs <strong>NCG</strong> vs baseline to a recruiter.
          </p>
        </div>
        <div className="hero-flow-side">
          <h2>What to look for</h2>
          <ul className="list">
            <li>Router mode choice (`kg`, `ncg`, `hybrid`) and rationale</li>
            <li>Whether the graph answer cites events / state changes / evidence refs</li>
            <li>Whether the baseline misses chronology or relationship-state transitions</li>
          </ul>
          <p className="muted" style={{ marginBottom: 0 }}>
            Need deeper inspection? Jump from evidence rows into guided <Link href="/trace">Trace Review</Link>.
          </p>
        </div>
      </section>

      <section className="grid compare-intent-grid" style={{ marginTop: '1rem' }} aria-label="Question archetypes">
        <article className="card simple-explainer-card">
          <p className="eyebrow">KG strength</p>
          <h2>Who is connected to whom?</h2>
          <p className="muted">Entity neighborhoods and labeled relationships are usually enough here.</p>
        </article>
        <article className="card simple-explainer-card">
          <p className="eyebrow">NCG strength</p>
          <h2>How did a relationship change?</h2>
          <p className="muted">NCG helps when chronology and state transitions matter, not just entity links.</p>
        </article>
        <article className="card simple-explainer-card">
          <p className="eyebrow">Hybrid strength</p>
          <h2>What happened and who mattered?</h2>
          <p className="muted">Hybrid answers combine canonical entities with narrative sequence and evidence traces.</p>
        </article>
      </section>

      <QueryWorkbench
        presets={[...COMPARE_PRESETS]}
        initialQuestion={COMPARE_PRESETS[0].question}
        initialIncludeBaselineComparison
        autoRunInitial
        layoutVariant="focus"
        showFocusHelper={false}
        inputVariant="compare"
        compactStructuredAnswer
        forceBaselineComparison
        submitLabel="Compare"
      />

      <section className="card" style={{ marginTop: '1rem' }}>
        <div className="benchmark-rail-header">
          <h2>After this screen</h2>
          <Link href="/how-it-works" className="button secondary">
            How It Works
          </Link>
        </div>
        <p className="muted" style={{ marginBottom: '0.5rem' }}>
          This page teaches the conceptual difference. The next page shows the engineering pipeline and validation gates behind
          the answers.
        </p>
        <div className="pill-row">
          <Link href="/advanced" className="button secondary">
            Advanced Tools
          </Link>
          <Link href="/benchmarks" className="button secondary">
            Fixture Runner (Advanced)
          </Link>
        </div>
      </section>
    </main>
  );
}

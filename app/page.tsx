import Image from 'next/image';

import FirstRunExplainerGate from '@/components/FirstRunExplainerGate';
import QueryWorkbench from '@/components/QueryWorkbench';
import { getDatasetSummary } from '@/lib/datasetSummary';

const ASK_PRESETS = [
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
    label: 'Frank KG neighbors',
    question: 'Who are the key people connected to Frank Sheeran?',
    includeBaselineComparison: false,
  },
  {
    label: 'Warning Hoffa evidence',
    question: 'What evidence shows Frank warning Hoffa near the end?',
    includeBaselineComparison: false,
  },
] as const;

export default async function HomePage() {
  const datasetSummary = await getDatasetSummary();

  return (
    <FirstRunExplainerGate>
      <main id="main-content">
        <section className="hero ask-home-hero" aria-labelledby="ask-page-title">
          <h1 id="ask-page-title" className="ask-home-title">
            Ask a question about The Irishman.
          </h1>
          <div className="hero-flow-side ask-home-side">
            <div className="ask-character-grid" aria-label="Main characters">
              <article className="ask-character-card">
                <Image
                  src="/characters/frank-sheeran.jpg"
                  alt="Photo of Robert De Niro as reference for Frank Sheeran"
                  width={320}
                  height={320}
                  sizes="(max-width: 1000px) 100vw, 220px"
                  quality={95}
                />
                <div>
                  <strong>Frank Sheeran</strong>
                  <p className="muted">Best for network and motive questions.</p>
                </div>
              </article>
              <article className="ask-character-card">
                <Image
                  src="/characters/peggy-sheeran.jpg"
                  alt="Photo of Anna Paquin as reference for Peggy Sheeran"
                  width={320}
                  height={320}
                  sizes="(max-width: 1000px) 100vw, 220px"
                  quality={95}
                />
                <div>
                  <strong>Peggy Sheeran</strong>
                  <p className="muted">Best for relationship-change questions.</p>
                </div>
              </article>
              <article className="ask-character-card">
                <Image
                  src="/characters/jimmy-hoffa.jpg"
                  alt="Photo of Jimmy Hoffa"
                  width={320}
                  height={320}
                  sizes="(max-width: 1000px) 100vw, 220px"
                  quality={95}
                />
                <div>
                  <strong>Jimmy Hoffa</strong>
                  <p className="muted">Best for timeline and causality questions.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <QueryWorkbench
          presets={[...ASK_PRESETS]}
          initialIncludeBaselineComparison={false}
          layoutVariant="focus"
          showFocusHelper={false}
          inputVariant="simple"
          compactStructuredAnswer
          advancedOptionsOpenByDefault={false}
          showVisualCanvas
          showAdvancedOptions={false}
          showEvidencePanel={false}
        />

        <details className="card home-mode-guide data-snapshot-panel" style={{ marginTop: '1rem' }}>
          <summary className="home-mode-guide-summary">
            <span>Data + build snapshot (optional engineering context)</span>
            <span className="muted">expand for counts and build metadata</span>
          </summary>
          <div className="home-mode-guide-body">
            <div className="data-snapshot-grid">
              <article>
                <h2>Current Artifact Counts</h2>
                <dl className="kv">
                  <dt>Scenes</dt>
                  <dd>{datasetSummary.scenes ?? 'Pending'}</dd>
                  <dt>Utterances</dt>
                  <dd>{datasetSummary.utterances ?? 'Pending'}</dd>
                  <dt>Action Beats</dt>
                  <dd>{datasetSummary.actionBeats ?? 'Pending'}</dd>
                  <dt>Events</dt>
                  <dd>{datasetSummary.events ?? 'Pending'}</dd>
                </dl>
              </article>
              <article>
                <h2>Parser / Build</h2>
                <dl className="kv">
                  <dt>Parser Version</dt>
                  <dd>{datasetSummary.parserVersion ?? 'Unknown'}</dd>
                  <dt>Parser Build</dt>
                  <dd>{datasetSummary.lastBuildTimestamp ?? 'Unknown'}</dd>
                  <dt>Explicit Scene Headers</dt>
                  <dd>{datasetSummary.explicitSceneHeaders ?? 'Unknown'}</dd>
                  <dt>Synthetic Scenes</dt>
                  <dd>{datasetSummary.syntheticScenes ?? 'Unknown'}</dd>
                </dl>
              </article>
            </div>
          </div>
        </details>
      </main>
    </FirstRunExplainerGate>
  );
}

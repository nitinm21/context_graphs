import AnswerPanel from '@/components/AnswerPanel';
import type { ApiQueryResponse } from '@/lib/queryContract';

type BaselineComparisonPanelProps = {
  response: ApiQueryResponse | null;
  enabled: boolean;
  isLoading?: boolean;
};

export default function BaselineComparisonPanel({ response, enabled, isLoading = false }: BaselineComparisonPanelProps) {
  if (!enabled) {
    return null;
  }

  return (
    <section className="card comparison-shell" aria-labelledby="comparison-title">
      <div className="comparison-header">
        <div>
          <p className="eyebrow" style={{ marginBottom: '0.35rem' }}>
            Comparison UX
          </p>
          <h2 id="comparison-title" style={{ marginBottom: '0.25rem' }}>
            Baseline retrieval vs structured graph answer
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            The graph answer is selected by deterministic routing and can cite event/state structures; the baseline is lexical chunk retrieval only.
          </p>
        </div>
      </div>

      {!response ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Run a query with baseline comparison enabled to populate this panel.
        </p>
      ) : (
        <>
          {isLoading ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Refreshing comparison…
            </p>
          ) : null}
          <div className="comparison-grid">
            <AnswerPanel title="Structured Graph Answer" answer={response} compact question={response.question} />
            <AnswerPanel
              title="Baseline Retrieval Answer"
              answer={response.baseline_comparison}
              compact
              question={response.question}
              emptyMessage="No baseline payload returned yet. Toggle comparison and rerun the query."
            />
          </div>

          <div className="comparison-footnotes">
            <div className="card" style={{ padding: '0.85rem' }}>
              <h3 style={{ marginTop: 0 }}>Why they differ</h3>
              <ul className="list">
                <li>KG/NCG answers traverse structured nodes and edges (entities, events, state changes).</li>
                <li>Baseline answers rank text chunks by lexical overlap and summarize top matches.</li>
                <li>Evidence support counts are surfaced explicitly in the structured answer contract.</li>
              </ul>
            </div>
            <div className="card" style={{ padding: '0.85rem' }}>
              <h3 style={{ marginTop: 0 }}>What to inspect</h3>
              <ul className="list">
                <li>Mode badge (`kg`, `ntg`, `hybrid`, `baseline_rag`) and router reasoning notes.</li>
                <li>Counts of `events_used`, `state_changes_used`, and `evidence_refs`.</li>
                <li>Whether the baseline misses chronology or relationship-state transitions.</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

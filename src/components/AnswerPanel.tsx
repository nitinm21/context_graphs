import ModeBadge, { type AnswerModeView } from '@/components/ModeBadge';
import type { ApiQueryResponse, QueryType } from '@/lib/queryContract';

type AnswerBlock = {
  query_type: QueryType;
  mode_used: AnswerModeView;
  answer_text: string;
  confidence: number;
  entities_used: string[];
  events_used: string[];
  state_changes_used: string[];
  evidence_refs: string[];
  reasoning_notes: string;
};

type AnswerPanelProps = {
  title?: string;
  answer: AnswerBlock | ApiQueryResponse | null;
  question?: string;
  compact?: boolean;
  emptyMessage?: string;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function renderMultiline(text: string) {
  const lines = text.split('\n').map((line) => line.trimEnd());
  return (
    <div className="answer-lines" role="list">
      {lines.map((line, index) => (
        <div key={`${index}-${line.slice(0, 32)}`} role="listitem" className={line ? 'answer-line' : 'answer-line answer-line-gap'}>
          {line || '\u00a0'}
        </div>
      ))}
    </div>
  );
}

function isFullResponse(answer: AnswerBlock | ApiQueryResponse): answer is ApiQueryResponse {
  return 'question' in answer;
}

export default function AnswerPanel({
  title = 'Structured Answer',
  answer,
  question,
  compact = false,
  emptyMessage = 'Run a query to see a structured answer.',
}: AnswerPanelProps) {
  if (!answer) {
    return (
      <article className="card answer-panel">
        <h2>{title}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {emptyMessage}
        </p>
      </article>
    );
  }

  const displayQuestion = question ?? (isFullResponse(answer) ? answer.question : null);
  const confidencePct = clampPercent(answer.confidence);

  return (
    <article className={`card answer-panel ${compact ? 'compact' : ''}`}>
      <div className="answer-panel-header">
        <div>
          <h2>{title}</h2>
          {displayQuestion ? <p className="muted answer-question">{displayQuestion}</p> : null}
        </div>
        <ModeBadge mode={answer.mode_used} queryType={answer.query_type} />
      </div>

      <div className="answer-confidence" aria-label={`Confidence ${confidencePct}%`}>
        <div className="answer-confidence-bar" style={{ width: `${confidencePct}%` }} />
      </div>
      <p className="muted answer-confidence-label" style={{ marginTop: '0.35rem' }}>
        Confidence {confidencePct}%
      </p>

      {renderMultiline(answer.answer_text)}

      <div className="answer-reasoning">
        <strong>Why this mode:</strong> {answer.reasoning_notes}
      </div>

      {!compact ? (
        <div className="answer-meta-grid">
          <div>
            <h3>Entities</h3>
            {answer.entities_used.length ? (
              <ul className="list mono">
                {answer.entities_used.slice(0, 10).map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None</p>
            )}
          </div>
          <div>
            <h3>Trace Rows</h3>
            <dl className="kv">
              <dt>Events Used</dt>
              <dd>{answer.events_used.length}</dd>
              <dt>State Changes</dt>
              <dd>{answer.state_changes_used.length}</dd>
              <dt>Evidence Refs</dt>
              <dd>{answer.evidence_refs.length}</dd>
            </dl>
          </div>
        </div>
      ) : null}
    </article>
  );
}

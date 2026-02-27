'use client';

import type { PreferredMode } from '@/lib/queryContract';
import type { QueryRouteDecision } from '@/lib/queryRouter';

type PresetQuestion = {
  label: string;
  question: string;
  includeBaselineComparison?: boolean;
  includeEvidence?: boolean;
};

type QuestionInputProps = {
  question: string;
  preferredMode: PreferredMode;
  includeEvidence: boolean;
  includeBaselineComparison: boolean;
  isSubmitting: boolean;
  routePreview: QueryRouteDecision | null;
  onQuestionChange: (value: string) => void;
  onPreferredModeChange: (value: PreferredMode) => void;
  onIncludeEvidenceChange: (value: boolean) => void;
  onIncludeBaselineComparisonChange: (value: boolean) => void;
  onSubmit: () => void;
  presets?: PresetQuestion[];
  onPresetSelect?: (preset: PresetQuestion) => void;
  submitLabel?: string;
  variant?: 'full' | 'simple' | 'compare';
  advancedOpenByDefault?: boolean;
  lockBaselineComparison?: boolean;
  showAdvancedOptions?: boolean;
};

export type { PresetQuestion };

export default function QuestionInput({
  question,
  preferredMode,
  includeEvidence,
  includeBaselineComparison,
  isSubmitting,
  routePreview,
  onQuestionChange,
  onPreferredModeChange,
  onIncludeEvidenceChange,
  onIncludeBaselineComparisonChange,
  onSubmit,
  presets = [],
  onPresetSelect,
  submitLabel = 'Ask',
  variant = 'full',
  advancedOpenByDefault = false,
  lockBaselineComparison = false,
  showAdvancedOptions = true,
}: QuestionInputProps) {
  const isSimple = variant === 'simple' || variant === 'compare';
  const isCompare = variant === 'compare';
  const title = isCompare
    ? 'Compare one question across graph reasoning and a retrieval-style baseline'
    : isSimple
      ? 'Ask one question, get an answer, and verify it with evidence'
      : 'Ask one question, see route choice, evidence, and baseline contrast';
  const subtitle = isCompare
    ? 'This flow keeps baseline comparison on so recruiters can see the structural difference between graph-backed and retrieval-style answers.'
    : isSimple
      ? ''
      : 'The router chooses KG, NCG, or hybrid deterministically before any optional LLM phase.';

  const askControls = (
    <>
      <label className="field">
        <span>Preferred Mode</span>
        <select
          name="preferredMode"
          value={preferredMode}
          onChange={(event) => onPreferredModeChange(event.target.value as PreferredMode)}
        >
          <option value="auto">auto (router decides)</option>
          <option value="kg">kg</option>
          <option value="ntg">ncg (internal mode: ntg)</option>
          <option value="hybrid">hybrid</option>
          <option value="baseline_rag">baseline_rag</option>
          <option value="baseline">baseline (alias)</option>
        </select>
      </label>

      <label className="checkline">
        <input
          type="checkbox"
          name="includeEvidence"
          checked={includeEvidence}
          onChange={(event) => onIncludeEvidenceChange(event.target.checked)}
        />
        <span>Include evidence refs</span>
      </label>

      {!lockBaselineComparison ? (
        <label className="checkline">
          <input
            type="checkbox"
            name="includeBaselineComparison"
            checked={includeBaselineComparison}
            onChange={(event) => onIncludeBaselineComparisonChange(event.target.checked)}
          />
          <span>Compare with baseline retrieval</span>
        </label>
      ) : (
        <div className="checkline static" aria-label="Baseline comparison is enabled">
          <span>Baseline comparison is enabled in this flow</span>
        </div>
      )}
    </>
  );

  return (
    <section className="card ask-shell" aria-labelledby="ask-title">
      <div className="ask-header">
        <div>
          <h2 id="ask-title" style={{ marginBottom: '0.35rem' }}>
            {title}
          </h2>
          {subtitle ? (
            <p className="muted" style={{ margin: 0 }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="ask-form"
      >
        <label htmlFor="question-input" className="field" style={{ width: '100%' }}>
          <span>Question</span>
          <textarea
            id="question-input"
            name="question"
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            autoComplete="off"
            placeholder="How does Peggy's relationship with Frank change over time?"
            rows={3}
          />
        </label>

        <div className="ask-primary-actions">
          <button type="submit" className="button" disabled={isSubmitting || !question.trim()}>
            {isSubmitting ? 'Running…' : submitLabel}
          </button>

          {!isSimple ? <div className="ask-controls">{askControls}</div> : null}
        </div>

        {isSimple && showAdvancedOptions ? (
          <details className="ask-advanced-options" open={advancedOpenByDefault}>
            <summary>
              <span>Advanced options</span>
              <span className="muted">mode override, evidence, baseline toggle</span>
            </summary>
            <div className="ask-controls ask-controls-advanced">{askControls}</div>
          </details>
        ) : null}
      </form>

      {presets.length ? (
        <div className="preset-strip" aria-label="Preset questions">
          {presets.map((preset) => (
            <button
              key={preset.label + preset.question}
              type="button"
              className="pill preset-pill"
              onClick={() => onPresetSelect?.(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}

    </section>
  );
}

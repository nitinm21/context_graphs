import type { QueryType } from '@/lib/queryContract';

export type AnswerModeView = 'kg' | 'ntg' | 'hybrid' | 'baseline_rag';

type ModeBadgeProps = {
  mode: AnswerModeView;
  queryType?: QueryType;
};

const MODE_LABELS: Record<AnswerModeView, string> = {
  kg: 'KG',
  ntg: 'NCG',
  hybrid: 'Hybrid',
  baseline_rag: 'Baseline RAG-like',
};

export default function ModeBadge({ mode, queryType }: ModeBadgeProps) {
  return (
    <span className={`mode-badge mode-${mode}`}>
      <span>{MODE_LABELS[mode]}</span>
      {queryType ? <span className="mode-badge-sub">{queryType.replaceAll('_', ' ')}</span> : null}
    </span>
  );
}

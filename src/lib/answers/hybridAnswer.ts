import type { StructuredAnswerCore } from '../queryContract';

import { buildKgAnswer } from './kgAnswer';
import { buildTraceAnswer } from './traceAnswer';
import { mergeAnswerCores, maybeStripEvidence, type AnswerBuilderContext } from './shared';

export async function buildHybridAnswer(context: AnswerBuilderContext): Promise<StructuredAnswerCore> {
  const [kgAnswer, traceAnswer] = await Promise.all([buildKgAnswer(context), buildTraceAnswer(context)]);

  const blendedText =
    context.queryType === 'comparison'
      ? [
          'Hybrid comparison answer:',
          'KG view (entity/relationship structure):',
          kgAnswer.answerText,
          '',
          'NTG view (timeline/state-change structure):',
          traceAnswer.answerText,
          '',
          'Use the baseline comparator for a lexical-only contrast if requested.',
        ].join('\n')
      : [
          'Hybrid answer (KG + NTG):',
          `- KG contribution: ${kgAnswer.reasoningNotes}`,
          `- NTG contribution: ${traceAnswer.reasoningNotes}`,
          '',
          'KG summary:',
          kgAnswer.answerText,
          '',
          'NTG summary:',
          traceAnswer.answerText,
        ].join('\n');

  const merged = mergeAnswerCores(kgAnswer, traceAnswer, {
    modeUsed: 'hybrid',
    answerText: blendedText,
    queryType: context.queryType,
    confidence: Math.min(0.93, Math.max(kgAnswer.confidence, traceAnswer.confidence) * 0.97 + 0.03),
    reasoningNotes:
      'Hybrid mode combined KG entity-relationship facts with NTG chronology/state-change evidence to answer a query that spans both structures.',
  });

  return maybeStripEvidence(merged, context.includeEvidence);
}

import { appendDevDebugLog } from '../devDebug';
import type { OmbreMemoryPlan, OmbrePromptMeta } from './ombreTypes';

export function appendOmbreMemoryPlanDebugLog(
  promptMeta: OmbrePromptMeta | undefined,
  memoryPlan: OmbreMemoryPlan | undefined,
): void {
  if (!memoryPlan || memoryPlan.mode === 'off') return;

  appendDevDebugLog('api', {
    label: '[ombre] memory dry-run plan',
    data: {
      promptMeta,
      memoryPlan,
    },
  });
}

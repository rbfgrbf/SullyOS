import { describe, expect, it, vi } from 'vitest';
import { appendDevDebugLog } from '../devDebug';
import { appendOmbreMemoryPlanDebugLog } from './ombreDebug';

vi.mock('../devDebug', () => ({
  appendDevDebugLog: vi.fn(),
}));

describe('appendOmbreMemoryPlanDebugLog', () => {
  it('skips off plans', () => {
    appendOmbreMemoryPlanDebugLog({ writeMode: 'off' } as any, { mode: 'off', riskFlags: [] });

    expect(appendDevDebugLog).not.toHaveBeenCalled();
  });

  it('records dry-run plans through the existing api capture channel', () => {
    appendOmbreMemoryPlanDebugLog(
      { writeMode: 'dry-run', feature: 'chat' } as any,
      {
        mode: 'dry-run',
        proposedTool: 'hold',
        arguments: { content: 'candidate' },
        riskFlags: ['dry-run-not-written'],
      },
    );

    expect(appendDevDebugLog).toHaveBeenCalledWith('api', {
      label: '[ombre] memory dry-run plan',
      data: {
        promptMeta: { writeMode: 'dry-run', feature: 'chat' },
        memoryPlan: {
          mode: 'dry-run',
          proposedTool: 'hold',
          arguments: { content: 'candidate' },
          riskFlags: ['dry-run-not-written'],
        },
      },
    });
  });
});

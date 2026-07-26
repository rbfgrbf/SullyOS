import { describe, expect, it, vi } from 'vitest';
import {
  buildOmbreConfirmedFinalPreflight,
} from './ombreConfirmedWritePreflight';
import {
  approveOmbreQueueItem,
  enqueueOmbreMemoryPlan,
  type OmbreConfirmedWriteQueueItem,
} from './ombreConfirmedWriteQueue';
import type { OmbreMemoryPlan } from './ombreTypes';

const basePlan: OmbreMemoryPlan = {
  mode: 'dry-run',
  proposedTool: 'hold',
  arguments: {
    content: 'Remember that final confirmed writes need one last page preflight.',
    tags: ['sullyos', 'preflight'],
    importance: 5,
    pinned: false,
    test_data: true,
    why_remembered: 'The user approved a visible candidate.',
    meaning: 'A final UI-only gate is required before any future write.',
  },
  source: {
    app: 'SullyOS',
    feature: 'chat',
    charId: 'char-xiaoguai',
    messageIds: [901, '902b'],
    timestamp: 1_785_040_000_901,
  },
  approval: { required: true, status: 'pending', gate: 'dry-run' },
  expectedBucketType: 'dynamic',
  dedupeQuery: 'Remember that final confirmed writes need one last page preflight.',
  riskFlags: ['dry-run-not-written'],
};

function queuedItem(plan: OmbreMemoryPlan = basePlan): OmbreConfirmedWriteQueueItem {
  const item = enqueueOmbreMemoryPlan(plan);
  if (!item) throw new Error('expected queued item');
  return item;
}

function approvedItem(plan: OmbreMemoryPlan = basePlan): OmbreConfirmedWriteQueueItem {
  return approveOmbreQueueItem(queuedItem(plan));
}

describe('buildOmbreConfirmedFinalPreflight', () => {
  it('blocks when there is no candidate', () => {
    const result = buildOmbreConfirmedFinalPreflight({ item: null, finalConfirmed: true });

    expect(result).toMatchObject({
      ok: false,
      status: 'no-candidate',
    });
  });

  it('blocks pending candidates before the first approval step', () => {
    const result = buildOmbreConfirmedFinalPreflight({
      item: queuedItem(),
      finalConfirmed: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'candidate-not-approved',
    });
  });

  it('blocks approved candidates whose confirmed preview is invalid', () => {
    const item: OmbreConfirmedWriteQueueItem = {
      ...queuedItem(),
      status: 'approved',
      confirmedPreview: {
        ok: false,
        reason: 'content-required',
        riskFlags: ['content-required'],
      },
    };

    const result = buildOmbreConfirmedFinalPreflight({ item, finalConfirmed: true });

    expect(result).toMatchObject({
      ok: false,
      status: 'candidate-preview-invalid',
    });
  });

  it('blocks approved candidates until the final checkbox is checked', () => {
    const result = buildOmbreConfirmedFinalPreflight({
      item: approvedItem(),
      finalConfirmed: false,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'final-confirmation-required',
    });
  });

  it('allows approved and final-confirmed candidates with request and audit previews', () => {
    const result = buildOmbreConfirmedFinalPreflight({
      item: approvedItem(),
      finalConfirmed: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.status);
    expect(result.status).toBe('ready-for-final-write');
    expect(result.requestPreview.content).toBe(basePlan.arguments?.content);
    expect(result.auditPreview).toEqual({
      sourceMessageIds: [901, '902b'],
      feature: 'chat',
      charId: 'char-xiaoguai',
      contentHash: expect.stringMatching(/^hash:v1:/),
      contentPreview: 'Remember that final confirmed writes need one last page preflight.',
      riskFlags: ['dry-run-not-written'],
      readbackStatus: 'not-run',
      status: 'queued',
    });
    expect(result.warnings).toEqual([]);
  });

  it('keeps test_data out of the success request preview', () => {
    const result = buildOmbreConfirmedFinalPreflight({
      item: approvedItem(),
      finalConfirmed: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.status);
    expect('test_data' in (result.requestPreview as Record<string, unknown>)).toBe(false);
  });

  it('redacts possible secrets and caps the audit content preview', () => {
    const secretContent = 'password: correct horse battery staple and Bearer live-token-123456789 with extra text '.repeat(3);
    const result = buildOmbreConfirmedFinalPreflight({
      item: approvedItem({
        ...basePlan,
        arguments: {
          ...basePlan.arguments,
          content: secretContent,
        },
        riskFlags: ['dry-run-not-written', 'possible-secret-content'],
      }),
      finalConfirmed: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.status);
    expect([...result.auditPreview.contentPreview].length).toBeLessThanOrEqual(80);
    expect(result.auditPreview.contentPreview).not.toContain('correct horse battery staple');
    expect(result.auditPreview.contentPreview).not.toMatch(/Bearer\s+live-token/i);
    expect(result.auditPreview.riskFlags).toEqual(['dry-run-not-written', 'possible-secret-content']);
  });

  it('does not call fetch while building preflight state', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    buildOmbreConfirmedFinalPreflight({
      item: approvedItem(),
      finalConfirmed: true,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

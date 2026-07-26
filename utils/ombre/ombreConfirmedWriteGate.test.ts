import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewOmbreConfirmedWriteCandidate } from './ombreConfirmedWriteGate';
import type { OmbreMemoryPlan } from './ombreTypes';

const baseMemoryPlan: OmbreMemoryPlan = {
  mode: 'dry-run',
  proposedTool: 'hold',
  arguments: {
    content: 'Remember that I prefer careful review before any memory write.',
    tags: ['sullyos', 'feature:chat'],
    importance: 4,
    test_data: true,
  },
  source: {
    app: 'SullyOS',
    feature: 'chat',
    charId: 'c1',
    messageIds: [101],
    timestamp: 1_700_000_000_101,
  },
  expectedBucketType: 'dynamic',
  dedupeQuery: 'Remember that I prefer careful review before any memory write.',
  approval: { required: true, status: 'pending', gate: 'dry-run' },
  riskFlags: ['dry-run-not-written'],
};

function review(
  memoryPlan: OmbreMemoryPlan = baseMemoryPlan,
  overrides: Partial<Parameters<typeof reviewOmbreConfirmedWriteCandidate>[0]> = {},
) {
  return reviewOmbreConfirmedWriteCandidate({
    memoryPlan,
    humanApproved: true,
    strictNoTouch: false,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviewOmbreConfirmedWriteCandidate', () => {
  it('rejects a dry-run candidate until a human explicitly approves it', () => {
    const result = review(baseMemoryPlan, { humanApproved: false });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'human-approval-required',
    });
    expect(result.riskFlags).toEqual(expect.arrayContaining(['dry-run-not-written', 'human-approval-required']));
  });

  it.each(['off', 'confirmed'] as const)('rejects %s plans because only dry-run candidates can enter the gate', mode => {
    const result = review({ ...baseMemoryPlan, mode });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'memory-plan-must-be-dry-run',
    });
    expect(result.riskFlags).toEqual(expect.arrayContaining(['memory-plan-must-be-dry-run']));
  });

  it('allows a human-approved dry-run hold candidate and requires readback audit', () => {
    const result = review();

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error(result.reason);
    expect(result.tool).toBe('hold');
    expect(result.arguments).toEqual(baseMemoryPlan.arguments);
    expect(result.audit).toEqual({
      source: baseMemoryPlan.source,
      riskFlags: ['dry-run-not-written'],
      touchedMetadata: false,
      requiresReadback: true,
    });
  });

  it('rejects candidates without a proposed tool or non-empty content', () => {
    const withoutTool = review({ ...baseMemoryPlan, proposedTool: undefined });
    const withoutContent = review({ ...baseMemoryPlan, arguments: { content: '   ' } });

    expect(withoutTool).toMatchObject({
      allowed: false,
      reason: 'missing-proposed-tool-or-content',
    });
    expect(withoutContent).toMatchObject({
      allowed: false,
      reason: 'missing-proposed-tool-or-content',
    });
  });

  it.each(['grow', 'trace', 'anchor', 'release', 'plan', 'letter_write'] as const)(
    'rejects %s because first confirmed draft only allows hold',
    proposedTool => {
      const result = review({ ...baseMemoryPlan, proposedTool });

      expect(result).toMatchObject({
        allowed: false,
        reason: 'write-tool-not-allowed',
      });
      expect(result.riskFlags).toEqual(expect.arrayContaining(['write-tool-not-allowed']));
    },
  );

  it('rejects I(content) because it is a write-shaped self-memory tool', () => {
    const result = review({
      ...baseMemoryPlan,
      proposedTool: 'I',
      arguments: { content: 'Remember this as an I memory.' },
      expectedBucketType: 'i',
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'write-tool-not-allowed',
    });
    expect(result.riskFlags).toEqual(expect.arrayContaining(['i-content-write-blocked']));
  });

  it.each([
    'Bearer test-token-for-gate',
    'api_key = test-key-1234567890',
    'password: correct horse battery staple',
    'verification code 123456',
    'recovery code alpha-bravo-charlie',
    '\u5bc6\u7801\uff1aabc123456',
    '\u9a8c\u8bc1\u7801\u662f123456',
    '\u6062\u590d\u7801 alpha-bravo-charlie',
  ])('hard-blocks suspicious secret content: %s', content => {
    const result = review({
      ...baseMemoryPlan,
      arguments: { ...baseMemoryPlan.arguments, content },
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'possible-secret-content',
    });
    expect(result.riskFlags).toEqual(expect.arrayContaining(['possible-secret-content']));
  });

  it('rejects dedupe metadata touch when strictNoTouch is enabled', () => {
    const result = review(baseMemoryPlan, {
      strictNoTouch: true,
      dedupeTouchedMetadata: true,
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'strict-no-touch-dedupe-blocked',
    });
    expect(result.riskFlags).toEqual(expect.arrayContaining(['strict-no-touch-dedupe-blocked']));
  });

  it('does not call network APIs while reviewing a candidate', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    const result = review();

    expect(result.allowed).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

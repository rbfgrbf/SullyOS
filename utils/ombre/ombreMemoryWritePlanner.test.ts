import { describe, expect, it } from 'vitest';
import { buildOmbreMemoryWritePlan } from './ombreMemoryWritePlanner';

const baseInput: any = {
  char: { id: 'c1', name: 'Xiaoguai' },
  userProfile: { name: 'Me' },
  groups: [],
  emojis: [],
  categories: [],
  recentMsgsHint: [{
    id: 101,
    charId: 'c1',
    role: 'user',
    type: 'text',
    content: 'Please remember that I prefer careful answers before code changes.',
    timestamp: 1_700_000_000_101,
  }],
  feature: 'chat',
  config: {
    enabled: true,
    corePrompt: 'Ombre canonical core',
    memoryRecallMode: 'off',
    memoryWriteMode: 'dry-run',
    maxResults: 3,
    maxMemoryChars: 1200,
    strictNoTouch: false,
  },
};

describe('buildOmbreMemoryWritePlan', () => {
  it('returns off when write mode is off', () => {
    const result = buildOmbreMemoryWritePlan({
      ...baseInput,
      config: { ...baseInput.config, memoryWriteMode: 'off' },
    });

    expect(result).toEqual({ mode: 'off', riskFlags: [] });
  });

  it('blocks confirmed mode without producing a write payload', () => {
    const result = buildOmbreMemoryWritePlan({
      ...baseInput,
      config: { ...baseInput.config, memoryWriteMode: 'confirmed' },
    });

    expect(result.mode).toBe('off');
    expect(result.proposedTool).toBeUndefined();
    expect(result.arguments).toBeUndefined();
    expect(result.approval).toBeUndefined();
    expect(result.reason).toContain('Confirmed Ombre writes are blocked');
    expect(result.riskFlags).toEqual(['confirmed-write-blocked']);
  });

  it('creates an inspectable hold dry-run proposal from the current user message', () => {
    const result = buildOmbreMemoryWritePlan(baseInput);

    expect(result.mode).toBe('dry-run');
    expect(result.proposedTool).toBe('hold');
    expect(result.arguments).toMatchObject({
      content: 'Please remember that I prefer careful answers before code changes.',
      tags: ['sullyos', 'feature:chat'],
      importance: 4,
      pinned: false,
      test_data: true,
    });
    expect(result.source).toMatchObject({
      app: 'SullyOS',
      feature: 'chat',
      charId: 'c1',
      messageIds: [101],
    });
    expect(result.expectedBucketType).toBe('dynamic');
    expect(result.dedupeQuery).toContain('prefer careful answers');
    expect(result.approval).toMatchObject({ required: true, status: 'pending', gate: 'dry-run' });
    expect(result.riskFlags).toEqual(['dry-run-not-written']);
  });

  it('does not propose a write payload when the latest message is not a user text candidate', () => {
    const result = buildOmbreMemoryWritePlan({
      ...baseInput,
      recentMsgsHint: [{
        id: 102,
        charId: 'c1',
        role: 'assistant',
        type: 'text',
        content: 'Assistant generated text should not be written as user memory.',
        timestamp: 1_700_000_000_102,
      }],
    });

    expect(result.mode).toBe('dry-run');
    expect(result.proposedTool).toBeUndefined();
    expect(result.arguments).toBeUndefined();
    expect(result.riskFlags).toContain('no-current-user-memory-candidate');
  });

  it('flags duplicate, private, and non-chat risks without calling write tools', () => {
    const result = buildOmbreMemoryWritePlan({
      ...baseInput,
      feature: 'proactive',
      recentMsgsHint: [{
        id: 103,
        charId: 'c1',
        role: 'user',
        type: 'text',
        content: 'Remember my phone 13800138000 and email test@example.com.',
        timestamp: 1_700_000_000_103,
      }],
    }, [{
      tool: 'breath',
      text: 'bucket_id: existing1\nRemembered preference',
      bucketIds: ['existing1'],
      chars: 40,
      touchesMetadata: false,
    }]);

    expect(result.proposedTool).toBe('hold');
    expect(result.riskFlags).toEqual(expect.arrayContaining([
      'dry-run-not-written',
      'possible-private-data',
      'dedupe-against-recalled-buckets',
      'non-chat-source-review',
    ]));
    expect(result.arguments?.content).toContain('13800138000');
  });

  it('requires human summarization instead of hard-clipping long raw content into a payload', () => {
    const result = buildOmbreMemoryWritePlan({
      ...baseInput,
      recentMsgsHint: [{
        id: 104,
        charId: 'c1',
        role: 'user',
        type: 'text',
        content: `remember ${'very long private raw note '.repeat(60)}`,
        timestamp: 1_700_000_000_104,
      }],
    });

    expect(result.proposedTool).toBeUndefined();
    expect(result.arguments).toBeUndefined();
    expect(result.riskFlags).toEqual(expect.arrayContaining([
      'content-too-long-for-direct-hold',
      'needs-human-summarization',
    ]));
  });
});

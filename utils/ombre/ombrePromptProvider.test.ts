import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildOmbreSystemPrompt } from './ombrePromptProvider';

const baseInput: any = {
  char: { id: 'c1', name: 'Xiaoguai' },
  userProfile: { name: 'me' },
  groups: [],
  emojis: [],
  categories: [],
  recentMsgsHint: [{ role: 'user', content: 'Do you remember our promise?', timestamp: Date.now() }],
  feature: 'chat',
  config: {
    enabled: true,
    corePrompt: 'Ombre canonical core',
    mcpEndpoint: 'http://127.0.0.1:18001/mcp',
    memoryRecallMode: 'search',
    memoryWriteMode: 'off',
    maxResults: 3,
    maxMemoryChars: 1200,
    strictNoTouch: false,
  },
};

describe('buildOmbreSystemPrompt', () => {
  it('keeps Chinese punctuation boundaries ASCII-safe in source', () => {
    const source = readFileSync(`${process.cwd()}/utils/ombre/ombrePromptProvider.ts`, 'utf8');
    const chineseFullStopLiteral = String.fromCharCode(0x3002);
    const fullwidthColonLiteral = String.fromCharCode(0xff1a);

    expect(source).toContain("'\\u3002'");
    expect(source).toContain('[:\\uff1a]');
    expect(source).not.toContain(`'${chineseFullStopLiteral}'`);
    expect(source).not.toContain(`[:${fullwidthColonLiteral}]`);
  });

  it('builds core plus reference memory without copying the current user message into system prompt', async () => {
    const callReadTool = vi.fn(async () => ({ text: 'bucket_id: b1\nPromise memory', touchesMetadata: true }));

    const result = await buildOmbreSystemPrompt(baseInput, { callReadTool });

    expect(result.systemPrompt).toContain('Ombre canonical core');
    expect(result.systemPrompt).toContain('Ombre Relevant Memory');
    expect(result.systemPrompt).toContain('Reference memory');
    expect(result.systemPrompt).toContain('Promise memory');
    expect(result.systemPrompt).not.toContain('Do you remember our promise?');
    expect(result.promptMeta.usedTools).toEqual(['breath_search']);
    expect(result.promptMeta.touchedMetadata).toBe(true);
    expect(result.promptMeta.memoryChars).toBeGreaterThan(0);
    expect(result.promptMeta.systemPromptChars).toBe(result.systemPrompt.length);
    expect(result.promptMeta.feature).toBe('chat');
    expect(result.promptMeta.recallMode).toBe('search');
    expect(result.promptMeta.writeMode).toBe('off');
    expect(result.memoryBlocks[0].bucketIds).toEqual(['b1']);
    expect(result.memoryPlan.mode).toBe('off');
    expect(result.memoryPlan.riskFlags).toEqual([]);
  });

  it('does not call breath_search or query breath_advanced when strictNoTouch is true', async () => {
    const callReadTool = vi.fn();
    const input = { ...baseInput, config: { ...baseInput.config, strictNoTouch: true } };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(callReadTool).not.toHaveBeenCalled();
    expect(result.warnings.join('\n')).toContain('strictNoTouch');
    expect(result.promptMeta.warnings.join('\n')).toContain('strictNoTouch');
    expect(result.promptMeta.usedTools).toEqual([]);
  });

  it('does not recall memory when memoryRecallMode is off and keeps memoryPlan off', async () => {
    const callReadTool = vi.fn();
    const input = { ...baseInput, config: { ...baseInput.config, memoryRecallMode: 'off' } };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(callReadTool).not.toHaveBeenCalled();
    expect(result.systemPrompt).toContain('Ombre canonical core');
    expect(result.systemPrompt).toContain('No relevant Ombre memory injected this turn.');
    expect(result.memoryPlan.mode).toBe('off');
    expect(result.promptMeta.usedTools).toEqual([]);
  });

  it('returns dry-run memory plan metadata without injecting it into the system prompt', async () => {
    const callReadTool = vi.fn();
    const input = {
      ...baseInput,
      recentMsgsHint: [{
        id: 201,
        charId: 'c1',
        role: 'user',
        type: 'text',
        content: 'Please remember that I prefer careful answers before code changes.',
        timestamp: 1_700_000_000_201,
      }],
      config: {
        ...baseInput.config,
        memoryRecallMode: 'off',
        memoryWriteMode: 'dry-run',
      },
    };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(callReadTool).not.toHaveBeenCalled();
    expect(result.memoryPlan.mode).toBe('dry-run');
    expect(result.memoryPlan.proposedTool).toBe('hold');
    expect(result.memoryPlan.arguments?.content).toContain('prefer careful answers');
    expect(result.memoryPlan.riskFlags).toContain('dry-run-not-written');
    expect(result.promptMeta.writeMode).toBe('dry-run');
    expect(result.systemPrompt).not.toContain('prefer careful answers');
  });

  it('skips recall with a warning when endpoint and proxy are not configured', async () => {
    const callReadTool = vi.fn(async () => ({ text: 'should not be used', touchesMetadata: true }));
    const input = {
      ...baseInput,
      config: {
        ...baseInput.config,
        mcpEndpoint: undefined,
        proxyEndpoint: undefined,
      },
    };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(callReadTool).not.toHaveBeenCalled();
    expect(result.systemPrompt).toContain('Ombre canonical core');
    expect(result.warnings.join('\n')).toContain('endpoint/proxy not configured');
    expect(result.warnings.join('\n')).toContain('skipped recall');
    expect(result.promptMeta.warnings).toEqual(result.warnings);
    expect(result.promptMeta.usedTools).toEqual([]);
  });

  it('keeps the core prompt and records a warning when Ombre recall fails', async () => {
    const callReadTool = vi.fn(async () => {
      throw new Error('Ombre MCP HTTP 400: Missing session');
    });

    const result = await buildOmbreSystemPrompt(baseInput, { callReadTool });

    expect(result.systemPrompt).toContain('Ombre canonical core');
    expect(result.systemPrompt).toContain('No relevant Ombre memory injected this turn.');
    expect(result.memoryBlocks).toEqual([]);
    expect(result.promptMeta.usedTools).toEqual([]);
    expect(result.promptMeta.writeMode).toBe('off');
    expect(result.warnings.join('\n')).toContain('Ombre recall failed');
    expect(result.warnings.join('\n')).toContain('Missing session');
  });

  it('clips long memory at a safe boundary with a marker without clipping core prompt', async () => {
    const longCore = 'CORE-'.repeat(40);
    const longMemory = ['first paragraph stays whole.', 'second paragraph should be clipped.', 'third paragraph omitted.'].join('\n\n');
    const callReadTool = vi.fn(async () => ({ text: longMemory, touchesMetadata: false }));
    const input = { ...baseInput, config: { ...baseInput.config, corePrompt: longCore, maxMemoryChars: 40 } };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(result.systemPrompt).toContain(longCore);
    expect(result.systemPrompt).toContain('first paragraph stays whole.');
    expect(result.systemPrompt).toContain('[Ombre memory clipped at a safe boundary:');
    expect(result.memoryBlocks[0].text).toContain('clipped');
    expect(result.memoryBlocks[0].chars).toBe(result.memoryBlocks[0].text.length);
  });

  it('extracts bucket ids with a fullwidth colon marker', async () => {
    const callReadTool = vi.fn(async () => ({ text: 'bucket_id\uff1ab_cn\nChinese bucket memory', touchesMetadata: false }));

    const result = await buildOmbreSystemPrompt(baseInput, { callReadTool });

    expect(result.memoryBlocks[0].bucketIds).toEqual(['b_cn']);
  });

  it('clips memory at a Chinese full stop boundary', async () => {
    const chineseFullStop = '\u3002';
    const longMemory = `first-cn-boundary${chineseFullStop}second-cn-boundary${chineseFullStop}third-cn-boundary`;
    const callReadTool = vi.fn(async () => ({ text: longMemory, touchesMetadata: false }));
    const input = { ...baseInput, config: { ...baseInput.config, maxMemoryChars: 20 } };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(result.memoryBlocks[0].text).toContain(`first-cn-boundary${chineseFullStop}`);
    expect(result.memoryBlocks[0].text).not.toContain('second-cn-boundary');
    expect(result.memoryBlocks[0].text).toContain('[Ombre memory clipped at a safe boundary:');
  });

  it('selects recall tools and arguments for breath, search, and advanced modes', async () => {
    const callReadTool = vi.fn(async () => ({ text: 'memory', touchesMetadata: false }));

    await buildOmbreSystemPrompt({ ...baseInput, config: { ...baseInput.config, memoryRecallMode: 'breath' } }, { callReadTool });
    await buildOmbreSystemPrompt({ ...baseInput, config: { ...baseInput.config, memoryRecallMode: 'search' } }, { callReadTool });
    await buildOmbreSystemPrompt({ ...baseInput, config: { ...baseInput.config, memoryRecallMode: 'advanced' }, recallQueryHint: 'explicit query' }, { callReadTool });

    expect(callReadTool.mock.calls[0][1]).toBe('breath');
    expect(callReadTool.mock.calls[0][2]).toEqual({});
    expect(callReadTool.mock.calls[1][1]).toBe('breath_search');
    expect(callReadTool.mock.calls[1][2]).toEqual({ query: 'Do you remember our promise?', max_results: 3 });
    expect(callReadTool.mock.calls[2][1]).toBe('breath_advanced');
    expect(callReadTool.mock.calls[2][2]).toEqual({ query: 'explicit query', max_results: 3 });
  });

  it('returns disabled metadata and no recall when provider is disabled', async () => {
    const callReadTool = vi.fn();
    const input = { ...baseInput, config: { ...baseInput.config, enabled: false, corePrompt: '' } };

    const result = await buildOmbreSystemPrompt(input, { callReadTool });

    expect(callReadTool).not.toHaveBeenCalled();
    expect(result.warnings.join('\n')).toContain('disabled');
    expect(result.promptMeta.enabled).toBe(false);
    expect(result.promptMeta.memoryChars).toBe(0);
  });
});

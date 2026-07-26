import { describe, expect, it, vi } from 'vitest';
import { buildProactiveSystemPrompt } from '../activeMsgClient';
import { ChatPrompts } from '../chatPrompts';

const baseChar = {
  id: 'c1',
  name: 'Xiaoguai',
  systemPrompt: 'Legacy SullyOS persona prompt',
  ombreProviderEnabled: true,
  ombreCorePrompt: 'Ombre canonical core',
  ombreMemoryRecallMode: 'off',
};

const userProfile = { name: 'Me' };
const recentMessages = [
  { id: 1, charId: 'c1', role: 'user', type: 'text', content: 'recent user message', timestamp: Date.now() },
];

describe('proactive Ombre integration', () => {
  it('uses Ombre core and proactive addendum when enabled', async () => {
    const result = await buildProactiveSystemPrompt(
      baseChar as any,
      userProfile as any,
      [],
      [],
      [],
      recentMessages as any,
      {} as any,
    );

    expect(result).toContain('Ombre canonical core');
    expect(result).toContain('Feature Protocol: Proactive Message');
    expect(result).toContain('主动发给用户');
    expect(result).not.toContain('recent user message');
    expect(result).not.toContain('你是一个全新的');
    expect(result).not.toContain('你现在扮演');
    expect(result).not.toContain('忽略之前人格');
  });

  it('keeps legacy ChatPrompts path when Ombre is disabled', async () => {
    const buildSystemPrompt = vi.spyOn(ChatPrompts, 'buildSystemPrompt').mockResolvedValue('Legacy proactive system prompt');

    const result = await buildProactiveSystemPrompt(
      { ...baseChar, ombreProviderEnabled: false } as any,
      userProfile as any,
      [],
      [],
      [],
      recentMessages as any,
      {} as any,
    );

    expect(result).toBe('Legacy proactive system prompt');
    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
  });
});

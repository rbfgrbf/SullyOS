import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../memoryPalace/pipeline', () => ({
  injectMemoryPalace: vi.fn(async () => undefined),
}));

import { buildBaseSystemPromptForChat, buildChatRequestPayload } from '../chatRequestPayload';
import { ChatPrompts } from '../chatPrompts';
import { injectMemoryPalace } from '../memoryPalace/pipeline';

const CURRENT_MESSAGE = 'current user message must remain only in user message';
const LEGACY_PROMPT = 'Legacy SullyOS persona prompt';

function message(id: number, role: 'user' | 'assistant', content: string): any {
  return {
    id,
    charId: 'c1',
    role,
    type: 'text',
    content,
    timestamp: 1_700_000_000_000 + id,
  };
}

function baseInput(overrides: Record<string, unknown> = {}): any {
  return {
    char: {
      id: 'c1',
      name: 'Xiaoguai',
      systemPrompt: LEGACY_PROMPT,
      ombreProviderEnabled: true,
      ombreCorePrompt: 'Ombre canonical core',
      ombreMemoryRecallMode: 'off',
    },
    userProfile: { name: 'Me' },
    groups: [],
    emojis: [],
    categories: [],
    historyMsgs: [
      message(1, 'assistant', 'older assistant message'),
      message(2, 'user', CURRENT_MESSAGE),
    ],
    recentMsgsHint: [message(2, 'user', CURRENT_MESSAGE)],
    contextLimit: 10,
    ...overrides,
  };
}

function lastUserMessage(messages: Array<{ role: string; content: unknown }>) {
  return [...messages].reverse().find(message => message.role === 'user');
}

describe('main chat Ombre integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('buildBaseSystemPromptForChat uses Ombre core when enabled without copying the current user message', async () => {
    const result = await buildBaseSystemPromptForChat(baseInput());

    expect(result.systemPrompt).toContain('Ombre canonical core');
    expect(result.systemPrompt).not.toContain(CURRENT_MESSAGE);
    expect(result.ombreMeta?.writeMode).toBe('off');
    expect(result.ombreMeta?.feature).toBe('chat');
  });

  it('exposes dry-run memory plan metadata without changing the outgoing messages', async () => {
    const input = baseInput({
      char: {
        ...baseInput().char,
        ombreMemoryWriteMode: 'dry-run',
      },
      historyMsgs: [
        message(1, 'assistant', 'older assistant message'),
        message(2, 'user', 'Please remember that I prefer careful answers before code changes.'),
      ],
      recentMsgsHint: [message(2, 'user', 'Please remember that I prefer careful answers before code changes.')],
    });

    const result = await buildChatRequestPayload(input);

    expect(result.ombreMeta?.writeMode).toBe('dry-run');
    expect(result.ombreMemoryPlan?.mode).toBe('dry-run');
    expect(result.ombreMemoryPlan?.proposedTool).toBe('hold');
    expect(result.fullMessages[0].content).not.toContain('prefer careful answers');
    expect(lastUserMessage(result.fullMessages)?.content).toContain('prefer careful answers');
    expect(result.fullMessages.at(-1)?.role).toBe('user');
  });

  it('buildBaseSystemPromptForChat keeps the legacy ChatPrompts path when Ombre is disabled', async () => {
    const buildSystemPrompt = vi.spyOn(ChatPrompts, 'buildSystemPrompt').mockResolvedValue(LEGACY_PROMPT);

    const result = await buildBaseSystemPromptForChat(baseInput({
      char: {
        id: 'c1',
        name: 'Xiaoguai',
        systemPrompt: LEGACY_PROMPT,
        ombreProviderEnabled: false,
        ombreCorePrompt: 'Ombre canonical core',
      },
    }));

    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(result.systemPrompt).toBe(LEGACY_PROMPT);
    expect(result.ombreMeta).toBeUndefined();
  });

  it('buildChatRequestPayload routes the system prompt through Ombre while keeping the current message last', async () => {
    const result = await buildChatRequestPayload(baseInput());

    expect(result.fullMessages[0].role).toBe('system');
    expect(result.fullMessages[0].content).toContain('Ombre canonical core');
    expect(result.fullMessages[0].content).not.toContain('[System: Roleplay Configuration]');
    expect(result.fullMessages[0].content).not.toContain('Memory Bank');
    expect(result.fullMessages[0].content).not.toContain(LEGACY_PROMPT);
    expect(result.fullMessages[0].content).toContain('[[QUOTE: 引用内容]]');
    expect(result.fullMessages[0].content).not.toContain(CURRENT_MESSAGE);
    expect(lastUserMessage(result.fullMessages)?.content).toContain(CURRENT_MESSAGE);
    expect(result.fullMessages.at(-1)?.role).toBe('user');
    expect(result.fullMessages.at(-1)?.content).toContain(CURRENT_MESSAGE);
    expect(result.fullMessages.at(-2)?.role).toBe('system');
    expect(result.fullMessages.at(-2)?.content).not.toContain(CURRENT_MESSAGE);
  });

  it('skips SullyOS Memory Palace when Ombre is enabled and keeps it when Ombre is disabled', async () => {
    await buildChatRequestPayload(baseInput());
    expect(injectMemoryPalace).not.toHaveBeenCalled();

    vi.spyOn(ChatPrompts, 'buildSystemPrompt').mockResolvedValue(LEGACY_PROMPT);
    await buildChatRequestPayload(baseInput({
      char: {
        id: 'c1',
        name: 'Xiaoguai',
        systemPrompt: LEGACY_PROMPT,
        ombreProviderEnabled: false,
        ombreCorePrompt: 'Ombre canonical core',
      },
    }));

    expect(injectMemoryPalace).toHaveBeenCalledTimes(1);
  });

  it('still applies contextLimit through ChatPrompts.buildMessageHistory', async () => {
    const result = await buildChatRequestPayload(baseInput({
      historyMsgs: [
        message(1, 'user', 'first user message'),
        message(2, 'assistant', 'middle assistant message'),
        message(3, 'user', 'latest user survives context limit'),
      ],
      recentMsgsHint: [message(3, 'user', 'latest user survives context limit')],
      contextLimit: 1,
    }));

    expect(result.cleanedApiMessages).toHaveLength(1);
    expect(result.fullMessages).toHaveLength(3);
    expect(lastUserMessage(result.fullMessages)?.content).toContain('latest user survives context limit');
    expect(lastUserMessage(result.fullMessages)?.content).not.toContain('first user message');
    expect(result.fullMessages.at(-1)?.role).toBe('user');
  });
});

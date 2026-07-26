import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildChatRequestPayload: vi.fn(),
  safeFetchJson: vi.fn(),
  getWorldEpisodes: vi.fn(),
  getRecentMessagesByCharId: vi.fn(),
  saveWorldEpisode: vi.fn(),
  saveWorld: vi.fn(),
  processNewMessages: vi.fn(),
}));

vi.mock('../chatRequestPayload', () => ({
  buildChatRequestPayload: mocks.buildChatRequestPayload,
}));

vi.mock('../safeApi', () => ({
  safeFetchJson: mocks.safeFetchJson,
}));

vi.mock('../db', () => ({
  DB: {
    getWorldEpisodes: mocks.getWorldEpisodes,
    getRecentMessagesByCharId: mocks.getRecentMessagesByCharId,
    saveWorldEpisode: mocks.saveWorldEpisode,
    saveWorld: mocks.saveWorld,
  },
}));

vi.mock('../memoryPalace/pipeline', () => ({
  processNewMessages: mocks.processNewMessages,
}));

import { runWorldEpisode } from './engine';

const g = globalThis as any;
if (typeof g.window === 'undefined') g.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
if (typeof g.document === 'undefined') g.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };

describe('runWorldEpisode Ombre payload wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getWorldEpisodes.mockResolvedValue([]);
    mocks.getRecentMessagesByCharId.mockResolvedValue([
      { id: 1, charId: 'a', role: 'user', type: 'text', content: 'old message', timestamp: 1 },
    ]);
    mocks.saveWorldEpisode.mockResolvedValue(undefined);
    mocks.saveWorld.mockResolvedValue(undefined);
    mocks.processNewMessages.mockResolvedValue(undefined);
    mocks.safeFetchJson.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            location: '厨房',
            narrative: '两个人平静地聊了几句。',
            mood: '平静',
          }),
        },
      }],
    });
  });

  it('passes each member context into buildChatRequestPayload', async () => {
    const capturedInputs: any[] = [];
    mocks.buildChatRequestPayload.mockImplementation(async (input: any) => {
      capturedInputs.push(input);
      return {
        systemPrompt: 'WORLD CORE',
        cleanedApiMessages: [{ role: 'assistant', content: 'previous line' }],
        fullMessages: [{ role: 'system', content: 'WORLD CORE' }],
        flags: {
          bilingualActive: false,
          mcdActive: false,
          luckinActive: false,
          luckinChatActive: false,
          htmlActive: false,
          thinkingActive: false,
          promptBuildSkipped: false,
        },
      };
    });

    const result = await runWorldEpisode({
      world: {
        id: 'w1',
        name: '栗子镇',
        worldview: '海边小镇',
        mode: 'light',
        timeMode: 'sim',
        injectToChat: false,
        memberIds: ['a', 'b'],
        npcs: [],
        houses: [],
        relationships: [],
        storyClock: 0,
        createdAt: 0,
        updatedAt: 0,
        api: { baseUrl: 'http://world-api.test', apiKey: 'key', model: 'model' },
        threads: [],
        seeds: [],
        directives: [],
      } as any,
      characters: [
        { id: 'a', name: '小满', contextLimit: 170 } as any,
        { id: 'b', name: '阿岚', contextLimit: 90 } as any,
      ],
      apiConfig: { baseUrl: 'http://fallback.test', apiKey: 'fallback', model: 'fallback' } as any,
      userProfile: { name: '小乖' } as any,
      groups: [],
      realtimeConfig: undefined,
      trigger: 'observe',
    });

    expect(result.ok).toBe(true);
    expect(capturedInputs).toHaveLength(2);
    expect(capturedInputs[0].contextLimit).toBe(170);
    expect(capturedInputs[0].recallQueryHint).toContain('阿岚');
    expect(capturedInputs[0].historyMsgs).toHaveLength(1);
    expect(capturedInputs[1].contextLimit).toBe(90);
    expect(capturedInputs[1].recallQueryHint).toContain('小满');
    expect(mocks.safeFetchJson).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(mocks.safeFetchJson.mock.calls[0][1].body as string);
    expect(firstBody.messages[0].content).toContain('WORLD CORE');
    expect(firstBody.messages.at(-1).content).toContain('小满');
  });
});

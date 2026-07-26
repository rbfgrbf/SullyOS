import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildChatRequestPayload: vi.fn(),
  safeFetchJson: vi.fn(),
  getVRApi: vi.fn(),
  logVRApiCall: vi.fn(),
  getVRNovels: vi.fn(),
  getVRMusicRoom: vi.fn(),
  getEmojis: vi.fn(),
  getEmojiCategories: vi.fn(),
  getRecentMessagesByCharId: vi.fn(),
  saveMessage: vi.fn(),
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
    getVRNovels: mocks.getVRNovels,
    getVRMusicRoom: mocks.getVRMusicRoom,
    getEmojis: mocks.getEmojis,
    getEmojiCategories: mocks.getEmojiCategories,
    getRecentMessagesByCharId: mocks.getRecentMessagesByCharId,
    saveMessage: mocks.saveMessage,
  },
}));

vi.mock('./vrApi', () => ({
  getVRApi: mocks.getVRApi,
  logVRApiCall: mocks.logVRApiCall,
}));

vi.mock('../memoryPalace/pipeline', () => ({
  processNewMessages: mocks.processNewMessages,
}));

import { runVRSession } from './runSession';

const g = globalThis as any;
if (typeof g.window === 'undefined') g.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
if (typeof g.document === 'undefined') g.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };

describe('runVRSession Ombre payload wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getVRApi.mockResolvedValue(null);
    mocks.getVRNovels.mockResolvedValue([]);
    mocks.getVRMusicRoom.mockResolvedValue(null);
    mocks.getEmojis.mockResolvedValue([]);
    mocks.getEmojiCategories.mockResolvedValue([]);
    mocks.getRecentMessagesByCharId.mockResolvedValue([
      { id: 1, charId: 'c1', role: 'user', type: 'text', content: 'old message', timestamp: 1 },
    ]);
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.processNewMessages.mockResolvedValue(undefined);
    mocks.logVRApiCall.mockImplementation(() => undefined);
    mocks.safeFetchJson.mockResolvedValue({
      choices: [{
        message: {
          content: '<行为>绕场一周</行为><动态>在娱乐室活动了一下筋骨。</动态>',
        },
      }],
    });
  });

  it('passes room-local context into buildChatRequestPayload', async () => {
    let capturedInput: any;
    mocks.buildChatRequestPayload.mockImplementation(async (input: any) => {
      capturedInput = input;
      return {
        systemPrompt: 'VR CORE',
        cleanedApiMessages: [{ role: 'assistant', content: 'previous line' }],
        fullMessages: [{ role: 'system', content: 'VR CORE' }],
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

    const updateCharacter = vi.fn().mockResolvedValue(undefined);

    const result = await runVRSession({
      char: {
        id: 'c1',
        name: '小满',
        contextLimit: 170,
        vrState: { enabled: true },
        memoryPalaceEnabled: false,
      } as any,
      characters: [
        { id: 'c1', name: '小满', vrState: { enabled: true, currentRoom: 'gym' } } as any,
        { id: 'c2', name: '阿岚', vrState: { enabled: true, currentRoom: 'gym' } } as any,
      ],
      apiConfig: { baseUrl: 'http://fallback.test', apiKey: 'fallback', model: 'fallback' } as any,
      userProfile: { name: '小乖', vrState: { enabled: false } } as any,
      groups: [],
      realtimeConfig: undefined,
      updateCharacter,
      forcedRoom: 'gym',
    });

    expect(result.ok).toBe(true);
    expect(capturedInput.contextLimit).toBe(170);
    expect(capturedInput.recallQueryHint).toContain('阿岚');
    expect(capturedInput.historyMsgs).toHaveLength(1);
    expect(mocks.safeFetchJson).toHaveBeenCalledTimes(1);
    expect(updateCharacter).toHaveBeenCalled();

    const body = JSON.parse(mocks.safeFetchJson.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain('VR CORE');
    expect(body.messages.at(-1).content).toContain('娱乐室');
  });
});

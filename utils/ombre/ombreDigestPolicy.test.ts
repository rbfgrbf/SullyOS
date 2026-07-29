import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import {
    buildDigestJobKey,
    computeDigestSourceHash,
    countCompletedRounds,
    estimateDigestChars,
} from './ombreDigestPolicy';

function makeUserAssistantPairs(count: number): Message[] {
    return Array.from({ length: count * 2 }, (_, index) => ({
        id: index + 1,
        charId: 'char-a',
        role: index % 2 === 0 ? 'user' : 'assistant',
        type: 'text',
        content: `message-${index + 1}`,
        timestamp: index + 1,
    } as Message));
}

describe('ombre digest policy', () => {
    it('counts only completed user/assistant rounds', () => {
        expect(countCompletedRounds(makeUserAssistantPairs(49))).toBe(49);
        expect(countCompletedRounds(makeUserAssistantPairs(50))).toBe(50);
        expect(countCompletedRounds([{ id: 1, charId: 'char-a', role: 'user', type: 'text', content: '未回复', timestamp: 1 } as Message])).toBe(0);
        expect(countCompletedRounds([{ id: 2, charId: 'char-a', role: 'system', type: 'system', content: 'tool noise', timestamp: 2 } as Message])).toBe(0);
    });

    it('estimates source characters from message content', () => {
        const messages = makeUserAssistantPairs(2);
        expect(estimateDigestChars(messages)).toBe(messages.reduce((total, message) => total + message.content.length, 0));
    });

    it('creates stable job keys and source hashes', async () => {
        const input = {
            charId: 'char-a',
            localDate: '2026-07-28',
            sourceStartMessageId: 1,
            sourceEndMessageId: 4,
            sourceHash: 'abc123',
        };
        expect(buildDigestJobKey(input)).toBe(buildDigestJobKey(input));

        const messages = makeUserAssistantPairs(2);
        expect(await computeDigestSourceHash(messages)).toMatch(/^[0-9a-f]{64}$/);
        expect(await computeDigestSourceHash(messages)).toBe(await computeDigestSourceHash(messages));
    });
});

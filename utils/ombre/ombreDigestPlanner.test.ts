import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import type { DigestTriggerConfig } from './ombreDigestPolicy';
import { planNextDigestSegment } from './ombreDigestPlanner';

const config: DigestTriggerConfig = {
    roundThreshold: 50,
    maxSourceChars: 1000,
    maxEstimatedTokens: 1000,
    periodBoundariesMinutes: [720, 1080, 1440],
};

function makePairs(count: number, startId = 1, contentLength = 8): Message[] {
    return Array.from({ length: count * 2 }, (_, index) => ({
        id: startId + index,
        charId: 'char-a',
        role: index % 2 === 0 ? 'user' : 'assistant',
        type: 'text',
        content: 'x'.repeat(contentLength),
        timestamp: Date.UTC(2026, 6, 28, 3, 0, index),
    } as Message));
}

describe('ombre digest planner', () => {
    it('does not trigger before the round threshold', async () => {
        await expect(planNextDigestSegment({
            messages: makePairs(49),
            lastProcessedMessageId: 0,
            reason: 'round-threshold',
            config,
            now: Date.UTC(2026, 6, 28, 10),
            timeZone: 'Asia/Shanghai',
        })).resolves.toBeNull();
    });

    it('plans one threshold-sized segment at 50 completed rounds', async () => {
        const result = await planNextDigestSegment({
            messages: makePairs(50),
            lastProcessedMessageId: 0,
            reason: 'round-threshold',
            config,
            now: Date.UTC(2026, 6, 28, 10),
            timeZone: 'Asia/Shanghai',
        });

        expect(result).toMatchObject({
            triggerReason: 'round-threshold',
            sourceMessageCount: 100,
            sourceStartMessageId: 1,
            sourceEndMessageId: 100,
        });
    });

    it('plans a segment early when the source size is too large', async () => {
        const result = await planNextDigestSegment({
            messages: makePairs(3, 1, 60),
            lastProcessedMessageId: 0,
            reason: 'size-threshold',
            config: { ...config, maxSourceChars: 100 },
            now: Date.UTC(2026, 6, 28, 10),
            timeZone: 'Asia/Shanghai',
        });

        expect(result).toMatchObject({ triggerReason: 'size-threshold' });
        expect(result?.sourceEndMessageId).toBeLessThanOrEqual(6);
        expect(result?.sourceMessageCount).toBeGreaterThan(0);
    });

    it('does not detach an unmatched user tail', async () => {
        const messages = [
            ...makePairs(2),
            { id: 5, charId: 'char-a', role: 'user', type: 'text', content: 'waiting', timestamp: Date.UTC(2026, 6, 28, 10, 1) },
        ] as Message[];
        const result = await planNextDigestSegment({
            messages,
            lastProcessedMessageId: 0,
            reason: 'period-boundary',
            config,
            now: Date.UTC(2026, 6, 28, 12),
            timeZone: 'Asia/Shanghai',
        });

        expect(result?.sourceEndMessageId).toBe(4);
        expect(result?.sourceMessages[result.sourceMessages.length - 1]?.role).toBe('assistant');
    });

    it('does not seal messages from the current period on a period tick', async () => {
        const result = await planNextDigestSegment({
            messages: Array.from({ length: 4 }, (_, index) => ({
                id: index + 1,
                charId: 'char-a',
                role: index % 2 === 0 ? 'user' : 'assistant',
                type: 'text',
                content: '当前时段',
                timestamp: Date.UTC(2026, 6, 28, 10, 0, index),
            } as Message)),
            lastProcessedMessageId: 0,
            reason: 'period-boundary',
            config,
            now: Date.UTC(2026, 6, 28, 10),
            timeZone: 'Asia/Shanghai',
        });

        expect(result).toBeNull();
    });

    it('seals only completed pairs from earlier periods', async () => {
        const messages = [
            { id: 1, charId: 'char-a', role: 'user', type: 'text', content: '早上的事实', timestamp: Date.UTC(2026, 6, 28, 3, 0) },
            { id: 2, charId: 'char-a', role: 'assistant', type: 'text', content: '早上的回复', timestamp: Date.UTC(2026, 6, 28, 3, 1) },
            { id: 3, charId: 'char-a', role: 'user', type: 'text', content: '下午的内容', timestamp: Date.UTC(2026, 6, 28, 5, 0) },
            { id: 4, charId: 'char-a', role: 'assistant', type: 'text', content: '下午的回复', timestamp: Date.UTC(2026, 6, 28, 5, 1) },
        ] as Message[];
        const result = await planNextDigestSegment({
            messages,
            lastProcessedMessageId: 0,
            reason: 'period-boundary',
            config,
            now: Date.UTC(2026, 6, 28, 5, 30),
            timeZone: 'Asia/Shanghai',
        });

        expect(result?.sourceMessages.map(message => message.id)).toEqual([1, 2]);
    });

    it('keeps consecutive user messages in the same completed round', async () => {
        const messages = [
            { id: 1, charId: 'char-a', role: 'user', type: 'text', content: '第一段', timestamp: 1 },
            { id: 2, charId: 'char-a', role: 'user', type: 'text', content: '补充段', timestamp: 2 },
            { id: 3, charId: 'char-a', role: 'assistant', type: 'text', content: '回复', timestamp: 3 },
        ] as Message[];
        const result = await planNextDigestSegment({
            messages,
            lastProcessedMessageId: 0,
            reason: 'period-boundary',
            config,
            now: Date.UTC(2026, 6, 28, 12),
            timeZone: 'Asia/Shanghai',
        });

        expect(result?.sourceMessageCount).toBe(3);
        expect(result?.sourceMessages.map(message => message.content)).toEqual(['第一段', '补充段', '回复']);
    });
});

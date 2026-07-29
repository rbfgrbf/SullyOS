import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../../types';
import {
    parseDigestModelOutput,
    requestOmbreDigest,
    sanitizeDigestMessages,
} from './ombreDigestBridgeClient';

const validOutput = {
    storedClaims: [{ claim: '已存在的事实', sourceMessageIds: [1, 2] }],
    newMemoryItems: [{ claim: '新的事实', sourceMessageIds: [3] }],
    segmentSummary: '这一段发生了重要对话。',
    dailySummary: '',
    excluded: ['寒暄'],
};

const request = {
    protocolVersion: 1 as const,
    jobId: 'job-1',
    charId: 'char-a',
    localDate: '2026-07-28',
    messages: [{ id: 1, role: 'user' as const, type: 'text', timestamp: 1, content: 'hello' }],
};

function okFetch(body: unknown): typeof fetch {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => body } as Response)) as unknown as typeof fetch;
}

describe('ombre digest bridge client', () => {
    it('sanitizes secrets and strips message metadata', () => {
        const message = {
            id: 1,
            charId: 'char-a',
            role: 'user',
            type: 'text',
            content: 'api_key=sk-1234567890abcdef and keep this',
            timestamp: 1,
            metadata: { private: true },
            replyTo: { id: 0, content: 'old', name: 'x' },
        } as Message;
        const sanitized = sanitizeDigestMessages([message], { maxMessages: 10, maxCharsPerMessage: 100 });
        expect(sanitized[0].content).not.toContain('sk-');
        expect(sanitized[0]).not.toHaveProperty('metadata');
        expect(sanitized[0]).not.toHaveProperty('replyTo');
    });

    it('reports bridge network failures without exposing response bodies', async () => {
        const rejectedFetch = vi.fn(async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;
        await expect(requestOmbreDigest(request, { fetchImpl: rejectedFetch })).rejects.toThrow(/bridge/i);
    });

    it('times out a hanging bridge request', async () => {
        const hangingFetch = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch;
        await expect(requestOmbreDigest(request, { fetchImpl: hangingFetch, timeoutMs: 10 })).rejects.toThrow(/timeout/i);
    });

    it('accepts the strict digest schema and rejects malformed output', async () => {
        expect(parseDigestModelOutput(validOutput)).toEqual(validOutput);
        await expect(requestOmbreDigest(request, { fetchImpl: okFetch(validOutput) })).resolves.toEqual(validOutput);
        expect(() => parseDigestModelOutput({ newMemoryItems: 'not-array' })).toThrow(/schema/i);
    });
});


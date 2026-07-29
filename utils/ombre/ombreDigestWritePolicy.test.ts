import { describe, expect, it } from 'vitest';
import type { DigestClaim, OmbreDigestJob } from './ombreDigestTypes';
import {
    buildDigestHoldRequest,
    evaluateDigestMemoryClaim,
    isDigestDuplicateSearchHit,
} from './ombreDigestWritePolicy';

const job: OmbreDigestJob = {
    id: 'job-1',
    charId: 'char-xiaoguai',
    localDate: '2026-07-29',
    periodKey: '2026-07-29#0720-1080',
    sourceStartMessageId: 101,
    sourceEndMessageId: 140,
    sourceMessageCount: 40,
    sourceHash: 'hash-job-1',
    triggerReason: 'round-threshold',
    status: 'checkpointed',
    attempts: 1,
    updatedAt: 1_000,
};

function claim(text: string): DigestClaim {
    return { claim: text, sourceMessageIds: [123] };
}

describe('ombre digest write policy', () => {
    it('allows durable private body or relationship claims to be written automatically', () => {
        const item = claim('用户怕生肉，看到没有熟透的肉馅会明显不舒服。');
        const decision = evaluateDigestMemoryClaim(item);
        const mapped = buildDigestHoldRequest(job, item, decision);

        expect(decision.action).toBe('auto-write');
        expect(decision.importance).toBeGreaterThanOrEqual(6);
        expect(decision.tags).toContain('digest:body');
        expect(mapped.ok).toBe(true);
        if (mapped.ok) {
            expect(mapped.request.content).toBe(item.claim);
            expect(mapped.request.pinned).toBe(false);
            expect(mapped.request.tags).toContain('sullyos');
            expect(mapped.request.tags).toContain('feature:chat');
            expect(JSON.stringify(mapped.request)).not.toMatch(/test_data|Bearer|api[_-]?key/i);
        }
    });

    it('keeps low-value but repeatable daily action fragments as stage candidates instead of formal memories', () => {
        const decision = evaluateDigestMemoryClaim(claim('用户父亲今天早上买了豆浆。'));

        expect(decision.action).toBe('stage-candidate');
        expect(decision.reason).toBe('stage-background');
    });

    it('keeps one-off family breakfast purchases as stage candidates when they look like repeatable action history', () => {
        const decision = evaluateDigestMemoryClaim(claim('用户父亲买了豆浆、烧卖、肉包子。'));

        expect(decision.action).toBe('stage-candidate');
        expect(decision.reason).toBe('stage-background');
    });

    it('blocks account credentials and secrets before any MCP search or write', () => {
        const item = claim('用户的 API key 是 sk-1234567890abcdef1234567890abcdef。');
        const decision = evaluateDigestMemoryClaim(item);
        const mapped = buildDigestHoldRequest(job, item, decision);

        expect(decision.action).toBe('blocked');
        expect(decision.reason).toBe('possible-secret');
        expect(mapped.ok).toBe(false);
    });

    it('treats bucket-backed breath_search hits as duplicates', () => {
        expect(isDigestDuplicateSearchHit(
            '用户怕生肉，看到没有熟透的肉馅会明显不舒服。',
            'bucket c3eb0bae88bc 用户怕生肉，看到没有熟透的肉馅会明显不舒服。',
        )).toMatchObject({ duplicate: true, bucketIds: ['c3eb0bae88bc'] });
        expect(isDigestDuplicateSearchHit(
            '用户怕生肉，看到没有熟透的肉馅会明显不舒服。',
            'bucket aaaaaaaaaaaa 完全不相关的旧记忆。',
        )).toMatchObject({ duplicate: false, bucketIds: ['aaaaaaaaaaaa'] });
    });
});

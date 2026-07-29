import { describe, expect, it } from 'vitest';
import {
    getOmbreDigestStageCandidateWindow,
    pruneOmbreDigestStageCandidates,
    recordOmbreDigestStageCandidate,
} from './ombreDigestStagePool';

function makeInput(params: {
    charId: string;
    signature: string;
    localDate: string;
    claim: string;
    now: number;
    sourceMessageId: number;
}) {
    return {
        charId: params.charId,
        signature: params.signature,
        localDate: params.localDate,
        claim: params.claim,
        sourceMessageIds: [params.sourceMessageId],
        importance: 4,
        tags: ['sullyos', 'feature:chat'],
        dedupeQuery: params.claim,
        riskFlags: [],
        now: params.now,
    };
}

describe('ombre digest stage pool', () => {
    it('moves from observed to candidate to promote across distinct days', async () => {
        const prefix = `stage-${Date.now()}-${Math.random()}`;
        const charId = `${prefix}-char`;
        const signature = `${prefix}-buy-breakfast`;

        expect((await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-26',
            claim: '我爸给我买了早餐',
            now: 1,
            sourceMessageId: 11,
        }))).status).toBe('observed');

        expect((await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-27',
            claim: '我爸今天早上又给我买了早餐',
            now: 2,
            sourceMessageId: 12,
        }))).status).toBe('observed');

        const candidate = await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-28',
            claim: '我爸今天还是给我买早餐',
            now: 3,
            sourceMessageId: 13,
        }));
        expect(candidate.status).toBe('candidate');
        expect(candidate.uniqueDayCount).toBe(3);

        const promote = await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-29',
            claim: '我爸连续第四天给我买早餐',
            now: 4,
            sourceMessageId: 14,
        }));
        expect(promote.status).toBe('promote');
        expect(promote.uniqueDayCount).toBe(4);
        expect(promote.activeRecords.map(record => record.localDate)).toEqual([
            '2026-07-26',
            '2026-07-27',
            '2026-07-28',
            '2026-07-29',
        ]);

        const window = await getOmbreDigestStageCandidateWindow({
            charId,
            signature,
            referenceLocalDate: '2026-07-29',
        });
        expect(window.status).toBe('promote');
    });

    it('keeps same-day repeats on a single counted day', async () => {
        const prefix = `stage-same-day-${Date.now()}-${Math.random()}`;
        const charId = `${prefix}-char`;
        const signature = `${prefix}-buy-breakfast`;

        const first = await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-29',
            claim: '我爸给我买了早餐',
            now: 11,
            sourceMessageId: 21,
        }));
        const second = await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-29',
            claim: '今天我爸又给我买早餐',
            now: 12,
            sourceMessageId: 22,
        }));

        expect(first.status).toBe('observed');
        expect(second.status).toBe('observed');
        expect(second.uniqueDayCount).toBe(1);
        expect(second.activeRecords).toHaveLength(1);
        expect(second.activeRecords[0].occurrenceCount).toBe(2);
    });

    it('expires records that fall outside the four-day rolling window', async () => {
        const prefix = `stage-expiry-${Date.now()}-${Math.random()}`;
        const charId = `${prefix}-char`;
        const signature = `${prefix}-buy-breakfast`;

        await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-24',
            claim: '我爸给我买了早餐',
            now: 1,
            sourceMessageId: 31,
        }));
        await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-26',
            claim: '我爸给我买了早餐',
            now: 2,
            sourceMessageId: 32,
        }));
        await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-27',
            claim: '我爸给我买了早餐',
            now: 3,
            sourceMessageId: 33,
        }));
        await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-28',
            claim: '我爸给我买了早餐',
            now: 4,
            sourceMessageId: 34,
        }));
        const latest = await recordOmbreDigestStageCandidate(makeInput({
            charId,
            signature,
            localDate: '2026-07-29',
            claim: '我爸连续第五天给我买早餐',
            now: 5,
            sourceMessageId: 35,
        }));

        expect(latest.status).toBe('promote');
        expect(latest.activeRecords.map(record => record.localDate)).toEqual([
            '2026-07-26',
            '2026-07-27',
            '2026-07-28',
            '2026-07-29',
        ]);
        expect(await pruneOmbreDigestStageCandidates({
            charId,
            referenceLocalDate: '2026-07-29',
        })).toBe(0);
    });
});

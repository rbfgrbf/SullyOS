import { describe, expect, it } from 'vitest';
import type { OmbreDigestJob } from './ombreDigestTypes';
import {
    getLatestCompletedOmbreDigestJob,
    getOmbreDigestJob,
    listOmbreDigestJobs,
    putOmbreDigestJob,
    updateOmbreDigestJob,
} from './ombreDigestDb';

function makeJob(id: string, charId: string, sourceEndMessageId: number, status: OmbreDigestJob['status'] = 'pending'): OmbreDigestJob {
    return {
        id,
        charId,
        localDate: '2026-07-28',
        periodKey: '2026-07-28#0720-1080',
        sourceStartMessageId: sourceEndMessageId - 1,
        sourceEndMessageId,
        sourceMessageCount: 2,
        sourceHash: `hash-${id}`,
        triggerReason: 'round-threshold',
        status,
        attempts: 0,
        updatedAt: Date.now(),
    };
}

describe('ombre digest IndexedDB queue', () => {
    it('inserts, retrieves, updates and filters jobs', async () => {
        const prefix = `digest-db-${Date.now()}-${Math.random()}`;
        const job = makeJob(`${prefix}-a`, `${prefix}-char-a`, 10);
        const other = makeJob(`${prefix}-b`, `${prefix}-char-b`, 99, 'checkpointed');

        await putOmbreDigestJob(job);
        await putOmbreDigestJob(other);
        expect(await getOmbreDigestJob(job.id)).toMatchObject(job);

        const updated = await updateOmbreDigestJob(job.id, { status: 'checkpointed', attempts: 1 });
        expect(updated.status).toBe('checkpointed');
        expect(await listOmbreDigestJobs(job.charId, ['checkpointed'])).toHaveLength(1);
        expect(await listOmbreDigestJobs(other.charId, ['checkpointed'])).toHaveLength(1);
    });

    it('selects the latest completed job for the requested character', async () => {
        const prefix = `digest-db-latest-${Date.now()}-${Math.random()}`;
        await putOmbreDigestJob(makeJob(`${prefix}-old`, `${prefix}-char-a`, 20, 'checkpointed'));
        await putOmbreDigestJob(makeJob(`${prefix}-new`, `${prefix}-char-a`, 30, 'write-unknown'));
        await putOmbreDigestJob(makeJob(`${prefix}-staged`, `${prefix}-char-a`, 40, 'stage-candidate'));
        await putOmbreDigestJob(makeJob(`${prefix}-other`, `${prefix}-char-b`, 300, 'checkpointed'));

        expect(await getLatestCompletedOmbreDigestJob(`${prefix}-char-a`)).toMatchObject({ sourceEndMessageId: 40 });
    });
});

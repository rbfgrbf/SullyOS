import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../../types';
import type { OmbreDigestJob } from './ombreDigestTypes';
import { runOmbreDigestCheck, type DigestRunnerDeps, type OmbreDigestConfig } from './ombreDigestRunner';

const config: OmbreDigestConfig = {
    targetCharId: 'char-a',
    mode: 'dry-run',
    autoWriteMode: 'off',
    bridgeEndpoint: 'http://127.0.0.1:17874',
    mcpEndpoint: 'http://127.0.0.1:18001/mcp',
    roundThreshold: 50,
    maxSourceChars: 100_000,
    maxEstimatedTokens: 30_000,
    periodBoundariesMinutes: [720, 1080, 1440],
    maxAttempts: 3,
    maxAutoWriteItems: 5,
};

function makeMessages(startId: number, rounds: number): Message[] {
    return Array.from({ length: rounds * 2 }, (_, index) => ({
        id: startId + index,
        charId: 'char-a',
        role: index % 2 === 0 ? 'user' : 'assistant',
        type: 'text',
        content: `message-${startId + index}`,
        timestamp: startId + index,
    } as Message));
}

function makeOutput() {
    return {
        storedClaims: [],
        newMemoryItems: [{ claim: '新事实', sourceMessageIds: [11] }],
        segmentSummary: '摘要',
        dailySummary: '',
        excluded: [],
    };
}

function makeDeps(overrides: Partial<DigestRunnerDeps> = {}): DigestRunnerDeps & { saved: OmbreDigestJob[] } {
    const saved: OmbreDigestJob[] = [];
    const deps: DigestRunnerDeps & { saved: OmbreDigestJob[] } = {
        saved,
        now: () => 1_000,
        loadConfig: () => config,
        getMessages: vi.fn(async () => makeMessages(11, 50)),
        listJobs: vi.fn(async () => saved),
        getLatestJob: vi.fn(async () => undefined),
        putJob: vi.fn(async job => {
            const index = saved.findIndex(item => item.id === job.id);
            if (index >= 0) saved[index] = job;
            else saved.push(job);
        }),
        updateJob: vi.fn(async (id, patch) => {
            const job = saved.find(item => item.id === id);
            if (!job) throw new Error('missing job');
            Object.assign(job, patch);
            return job;
        }),
        summarize: vi.fn(async () => makeOutput()),
        reconcile: vi.fn(async () => ({ status: 'readback-passed', bucketIds: [] })),
        ...overrides,
    };
    return deps;
}

describe('ombre digest runner', () => {
    it('does not read messages when disabled', async () => {
        const deps = makeDeps({ loadConfig: () => ({ ...config, mode: 'off' }), getMessages: vi.fn() });
        await expect(runOmbreDigestCheck('char-a', 'round-threshold', deps)).resolves.toEqual({ status: 'disabled' });
        expect(deps.getMessages).not.toHaveBeenCalled();
    });

    it('does not read or summarize a non-target character', async () => {
        const deps = makeDeps({
            getMessages: vi.fn(async () => makeMessages(11, 50)),
            summarize: vi.fn(),
        });

        await expect(runOmbreDigestCheck('char-b', 'round-threshold', deps))
            .resolves.toEqual({ status: 'not-target' });
        expect(deps.getMessages).not.toHaveBeenCalled();
        expect(deps.summarize).not.toHaveBeenCalled();
    });

    it('summarizes a 50-round segment and checkpoints it', async () => {
        const deps = makeDeps();
        const result = await runOmbreDigestCheck('char-a', 'round-threshold', deps);
        expect(result.status).toBe('checkpointed');
        expect(deps.summarize).toHaveBeenCalledTimes(1);
        expect(deps.reconcile).not.toHaveBeenCalled();
        expect(deps.saved[deps.saved.length - 1]).toMatchObject({ status: 'checkpointed', sourceStartMessageId: 11, sourceEndMessageId: 110 });
    });

    it('runs automatic reconcile after checkpoint when digest auto-write is confirmed', async () => {
        const deps = makeDeps({
            loadConfig: () => ({ ...config, autoWriteMode: 'confirmed' }),
            reconcile: vi.fn(async ({ job, updateJob, now }) => {
                await updateJob(job.id, {
                    status: 'readback-passed',
                    bucketIds: ['5202cd96db58'],
                    readbackStatus: 'passed',
                    auditId: 'audit-1',
                    updatedAt: now(),
                });
                return { status: 'readback-passed', bucketIds: ['5202cd96db58'], auditId: 'audit-1' };
            }),
        });

        const result = await runOmbreDigestCheck('char-a', 'round-threshold', deps);

        expect(result.status).toBe('readback-passed');
        expect(deps.reconcile).toHaveBeenCalledTimes(1);
        expect(deps.saved[deps.saved.length - 1]).toMatchObject({
            status: 'readback-passed',
            bucketIds: ['5202cd96db58'],
            readbackStatus: 'passed',
            auditId: 'audit-1',
        });
    });

    it('reconciles an existing checkpoint on startup recovery even when no new segment is planned', async () => {
        const existing: OmbreDigestJob = {
            id: 'existing-checkpoint',
            charId: 'char-a',
            localDate: '2026-07-29',
            periodKey: '2026-07-29#0720-1080',
            sourceStartMessageId: 11,
            sourceEndMessageId: 110,
            sourceMessageCount: 100,
            sourceHash: 'hash-existing',
            triggerReason: 'round-threshold',
            status: 'checkpointed',
            attempts: 1,
            updatedAt: 900,
            newMemoryItems: [{ claim: '用户怕生肉，看到没有熟透的肉馅会明显不舒服。', sourceMessageIds: [31] }],
        };
        const deps = makeDeps({
            loadConfig: () => ({ ...config, autoWriteMode: 'confirmed' }),
            getMessages: vi.fn(async () => makeMessages(11, 50)),
            listJobs: vi.fn(async () => [existing]),
            getLatestJob: vi.fn(async () => existing),
            reconcile: vi.fn(async () => ({ status: 'readback-passed', bucketIds: ['5202cd96db58'], auditId: 'audit-existing' })),
        });

        const result = await runOmbreDigestCheck('char-a', 'startup-recovery', deps);

        expect(result.status).toBe('readback-passed');
        expect(deps.summarize).not.toHaveBeenCalled();
        expect(deps.reconcile).toHaveBeenCalledTimes(1);
        expect(deps.reconcile).toHaveBeenCalledWith(expect.objectContaining({ job: existing }));
    });

    it('recovers a failed confirmed write caused by the old missing-session bug before summarizing again', async () => {
        const existing: OmbreDigestJob = {
            id: 'existing-session-failed',
            charId: 'char-a',
            localDate: '2026-07-29',
            periodKey: '2026-07-29#0720-1080',
            sourceStartMessageId: 11,
            sourceEndMessageId: 110,
            sourceMessageCount: 100,
            sourceHash: 'hash-existing',
            triggerReason: 'round-threshold',
            status: 'failed',
            attempts: 4,
            updatedAt: 900,
            lastError: 'Ombre confirmed hold HTTP 400: Bad Request: Missing session ID',
            newMemoryItems: [{ claim: '用户怕生肉，看到没有熟透的肉馅会明显不舒服。', sourceMessageIds: [31] }],
        };
        const deps = makeDeps({
            loadConfig: () => ({ ...config, autoWriteMode: 'confirmed' }),
            listJobs: vi.fn(async (_charId, statuses) => statuses?.includes(existing.status) ? [existing] : []),
            getLatestJob: vi.fn(async () => undefined),
            reconcile: vi.fn(async () => ({ status: 'readback-passed', bucketIds: ['5202cd96db58'], auditId: 'audit-recovered' })),
        });
        deps.saved.push(existing);

        const result = await runOmbreDigestCheck('char-a', 'startup-recovery', deps);

        expect(result.status).toBe('readback-passed');
        expect(deps.summarize).not.toHaveBeenCalled();
        expect(deps.updateJob).toHaveBeenCalledWith(existing.id, expect.objectContaining({
            status: 'checkpointed',
            attempts: 5,
            lastError: undefined,
        }));
        expect(deps.reconcile).toHaveBeenCalledWith(expect.objectContaining({
            job: expect.objectContaining({ id: existing.id, status: 'checkpointed', attempts: 5 }),
        }));
    });

    it('keeps the source range and watermark unchanged when summarization fails', async () => {
        const deps = makeDeps({ summarize: vi.fn(async () => { throw new Error('timeout'); }) });
        const result = await runOmbreDigestCheck('char-a', 'round-threshold', deps);
        expect(result).toMatchObject({ status: 'failed', errorCode: 'bridge-timeout', sourceEndMessageId: 110 });
        expect(deps.saved[deps.saved.length - 1]).toMatchObject({ status: 'failed', sourceStartMessageId: 11, sourceEndMessageId: 110, lastError: 'bridge-timeout' });
        expect(await deps.getLatestJob('char-a')).toBeUndefined();
    });
});

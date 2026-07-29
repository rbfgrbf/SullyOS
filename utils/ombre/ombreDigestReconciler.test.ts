import { describe, expect, it, vi } from 'vitest';
import type { OmbreDigestJob } from './ombreDigestTypes';
import type { RunOmbreConfirmedHoldWorkflowInput } from './ombreConfirmedWriteWorkflow';
import { reconcileOmbreDigestJob } from './ombreDigestReconciler';
import {
    buildOmbreDigestStageSignature,
    getOmbreDigestStageCandidateWindow,
    recordOmbreDigestStageCandidate,
} from './ombreDigestStagePool';

function checkpointJob(overrides: Partial<OmbreDigestJob> = {}): OmbreDigestJob {
    return {
        id: 'digest-job-1',
        charId: 'char-xiaoguai',
        localDate: '2026-07-29',
        periodKey: '2026-07-29#0720-1080',
        sourceStartMessageId: 101,
        sourceEndMessageId: 140,
        sourceMessageCount: 40,
        sourceHash: 'hash-digest-job-1',
        triggerReason: 'round-threshold',
        status: 'checkpointed',
        attempts: 1,
        updatedAt: 1_000,
        storedClaims: [],
        newMemoryItems: [{ claim: '用户怕生肉，看到没有熟透的肉馅会明显不舒服。', sourceMessageIds: [123] }],
        segmentSummary: '摘要',
        ...overrides,
    };
}

function deps(overrides: Record<string, unknown> = {}) {
    const updates: Partial<OmbreDigestJob>[] = [];
    const updateJob = vi.fn(async (_id: string, patch: Partial<OmbreDigestJob>) => {
        updates.push(patch);
        return { ...checkpointJob(), ...patch };
    });
    return {
        updates,
        targetCharId: 'char-xiaoguai',
        endpoint: 'http://127.0.0.1:18001/mcp',
        readbackConfig: {
            enabled: true,
            corePrompt: 'core',
            mcpEndpoint: 'http://127.0.0.1:18001/mcp',
            memoryRecallMode: 'search',
            memoryWriteMode: 'off',
            maxResults: 3,
            maxMemoryChars: 1200,
            strictNoTouch: false,
        },
        now: () => 2_000,
        updateJob,
        search: vi.fn(async (query: string) => ({ text: '', touchesMetadata: query.length > 0 })),
        runHoldWorkflow: vi.fn(async (_input: RunOmbreConfirmedHoldWorkflowInput) => ({
            ok: true,
            writeResult: { ok: true, bucketId: '5202cd96db58', text: 'created bucket 5202cd96db58', touchedMetadata: false },
            readbackStatus: 'passed' as const,
            auditId: 'audit-1',
        })),
        maxAutoWriteItems: 5,
        ...overrides,
    };
}

describe('ombre digest reconciler', () => {
    it('skips already-present candidates after breath_search and does not write them again', async () => {
        const testDeps = deps({
            search: vi.fn(async (query: string) => ({
                text: `bucket c3eb0bae88bc ${query}`,
                touchesMetadata: true,
            })),
            runHoldWorkflow: vi.fn(),
        });

        const result = await reconcileOmbreDigestJob(checkpointJob(), testDeps as any);

        expect(result.status).toBe('readback-passed');
        expect(testDeps.search).toHaveBeenCalledTimes(1);
        expect(testDeps.runHoldWorkflow).not.toHaveBeenCalled();
        expect(testDeps.updates.map(update => update.status)).toEqual(['reconciling', 'readback-passed']);
        expect(testDeps.updates.at(-1)).toMatchObject({
            bucketIds: ['c3eb0bae88bc'],
            readbackStatus: 'already-present',
        });
    });

    it('writes a new durable candidate with hold and records readback audit proof', async () => {
        const testDeps = deps();

        const result = await reconcileOmbreDigestJob(checkpointJob(), testDeps as any);

        expect(result.status).toBe('readback-passed');
        expect(testDeps.search).toHaveBeenCalledTimes(1);
        expect(testDeps.runHoldWorkflow).toHaveBeenCalledTimes(1);
        const workflowInput = testDeps.runHoldWorkflow.mock.calls[0][0] as RunOmbreConfirmedHoldWorkflowInput;
        expect(workflowInput.request.content).toContain('怕生肉');
        expect(workflowInput.request.tags).toContain('digest:body');
        expect(workflowInput.mappingAudit.source.charId).toBe('char-xiaoguai');
        expect(testDeps.updates.map(update => update.status)).toEqual(['reconciling', 'write-pending', 'readback-passed']);
        expect(testDeps.updates.at(-1)).toMatchObject({
            bucketIds: ['5202cd96db58'],
            readbackStatus: 'passed',
            auditId: 'audit-1',
        });
    });

    it('blocks possible secrets before breath_search or hold', async () => {
        const testDeps = deps();
        const result = await reconcileOmbreDigestJob(checkpointJob({
            newMemoryItems: [{ claim: '用户的 password=123456789 要记住。', sourceMessageIds: [124] }],
        }), testDeps as any);

        expect(result.status).toBe('needs-review');
        expect(testDeps.search).not.toHaveBeenCalled();
        expect(testDeps.runHoldWorkflow).not.toHaveBeenCalled();
        expect(testDeps.updates.at(-1)).toMatchObject({
            status: 'needs-review',
            lastError: 'blocked-possible-secret',
        });
    });

    it('marks write-unknown when hold succeeded but readback did not match', async () => {
        const testDeps = deps({
            runHoldWorkflow: vi.fn(async () => ({
                ok: false,
                writeResult: { ok: true, bucketId: '9f9f9f9f9f9f', text: 'created bucket 9f9f9f9f9f9f', touchedMetadata: false },
                readbackStatus: 'failed' as const,
                auditId: 'audit-readback-failed',
                error: 'readback mismatch',
            })),
        });

        const result = await reconcileOmbreDigestJob(checkpointJob(), testDeps as any);

        expect(result.status).toBe('write-unknown');
        expect(testDeps.runHoldWorkflow).toHaveBeenCalledTimes(1);
        expect(testDeps.updates.at(-1)).toMatchObject({
            status: 'write-unknown',
            bucketIds: ['9f9f9f9f9f9f'],
            readbackStatus: 'failed',
            auditId: 'audit-readback-failed',
        });
    });

    it('moves to needs-review when breath_search fails instead of assuming the memory is new', async () => {
        const testDeps = deps({
            search: vi.fn(async () => { throw new Error('MCP unavailable'); }),
            runHoldWorkflow: vi.fn(),
        });

        const result = await reconcileOmbreDigestJob(checkpointJob(), testDeps as any);

        expect(result.status).toBe('needs-review');
        expect(testDeps.runHoldWorkflow).not.toHaveBeenCalled();
        expect(testDeps.updates.at(-1)).toMatchObject({
            status: 'needs-review',
            lastError: 'dedupe-failed',
        });
    });

    it('does not store audit ids as bucket ids when Ombre does not return a bucket id', async () => {
        const testDeps = deps({
            runHoldWorkflow: vi.fn(async () => ({
                ok: true,
                writeResult: { ok: true, text: 'created memory without bucket id', touchedMetadata: false },
                readbackStatus: 'passed' as const,
                auditId: 'audit-without-bucket',
            })),
        });

        await reconcileOmbreDigestJob(checkpointJob(), testDeps as any);

        expect(testDeps.updates.at(-1)).toMatchObject({
            status: 'readback-passed',
            bucketIds: undefined,
            auditId: 'audit-without-bucket',
        });
    });

    it('stages repeatable daily action fragments without breath_search or hold before promotion', async () => {
        const prefix = `stage-reconcile-${Date.now()}-${Math.random()}`;
        const charId = `${prefix}-char`;
        const testDeps = deps({
            targetCharId: charId,
            search: vi.fn(),
            runHoldWorkflow: vi.fn(),
        });

        const result = await reconcileOmbreDigestJob(checkpointJob({
            id: `${prefix}-job`,
            charId,
            localDate: '2026-07-26',
            newMemoryItems: [{ claim: '用户父亲今天早上买了豆浆。', sourceMessageIds: [201] }],
        }), testDeps as any);

        expect(result.status).toBe('staged');
        expect(testDeps.search).not.toHaveBeenCalled();
        expect(testDeps.runHoldWorkflow).not.toHaveBeenCalled();
        expect(testDeps.updates.at(-1)).toMatchObject({
            status: 'stage-candidate',
            readbackStatus: 'staged',
        });
    });

    it('promotes a staged action on the fourth day through the existing hold workflow', async () => {
        const prefix = `stage-promote-${Date.now()}-${Math.random()}`;
        const charId = `${prefix}-char`;
        const claimText = '用户父亲今天早上买了豆浆。';
        const signature = buildOmbreDigestStageSignature(claimText);
        for (const [index, localDate] of ['2026-07-26', '2026-07-27', '2026-07-28'].entries()) {
            await recordOmbreDigestStageCandidate({
                charId,
                signature,
                localDate,
                claim: claimText,
                sourceMessageIds: [210 + index],
                importance: 4,
                tags: ['sullyos', 'feature:chat'],
                dedupeQuery: claimText,
                riskFlags: [],
                now: 100 + index,
            });
        }
        const testDeps = deps({ targetCharId: charId });

        const result = await reconcileOmbreDigestJob(checkpointJob({
            id: `${prefix}-job`,
            charId,
            localDate: '2026-07-29',
            newMemoryItems: [{ claim: claimText, sourceMessageIds: [214] }],
        }), testDeps as any);

        expect(result.status).toBe('readback-passed');
        expect(testDeps.search).toHaveBeenCalledTimes(1);
        expect(testDeps.runHoldWorkflow).toHaveBeenCalledTimes(1);
        const workflowInput = testDeps.runHoldWorkflow.mock.calls[0][0] as RunOmbreConfirmedHoldWorkflowInput;
        expect(workflowInput.request.content).toContain('豆浆');
        expect(workflowInput.request.pinned).toBe(false);
        expect(testDeps.updates.map(update => update.status)).toEqual(['reconciling', 'write-pending', 'readback-passed']);
        const remainingWindow = await getOmbreDigestStageCandidateWindow({
            charId,
            signature,
            referenceLocalDate: '2026-07-29',
        });
        expect(remainingWindow.uniqueDayCount).toBe(0);
    });

    it('does not process jobs from other characters', async () => {
        const testDeps = deps();
        const result = await reconcileOmbreDigestJob(checkpointJob({ charId: 'char-other' }), testDeps as any);

        expect(result.status).toBe('not-target');
        expect(testDeps.updateJob).not.toHaveBeenCalled();
        expect(testDeps.search).not.toHaveBeenCalled();
        expect(testDeps.runHoldWorkflow).not.toHaveBeenCalled();
    });
});

import { callOmbreReadTool } from './ombreMcpClient';
import type { OmbreProviderConfig } from './ombreTypes';
import type { OmbreDigestJob } from './ombreDigestTypes';
import { buildDigestHoldRequest, evaluateDigestMemoryClaim, isDigestDuplicateSearchHit } from './ombreDigestWritePolicy';
import {
    buildOmbreDigestStageSignature,
    clearOmbreDigestStageCandidates,
    recordOmbreDigestStageCandidate,
} from './ombreDigestStagePool';
import type { RunOmbreConfirmedHoldWorkflowInput, RunOmbreConfirmedHoldWorkflowResult } from './ombreConfirmedWriteWorkflow';
import { runOmbreConfirmedHoldWorkflow } from './ombreConfirmedWriteWorkflow';

export interface DigestReconcilerDeps {
    targetCharId: string;
    endpoint: string;
    readbackConfig: OmbreProviderConfig;
    now: () => number;
    updateJob: (id: string, patch: Partial<OmbreDigestJob>) => Promise<OmbreDigestJob>;
    search?: (query: string) => Promise<{ text: string; touchesMetadata: boolean }>;
    runHoldWorkflow?: (input: RunOmbreConfirmedHoldWorkflowInput) => Promise<RunOmbreConfirmedHoldWorkflowResult>;
    fetchImpl?: typeof fetch;
    storage?: Storage;
    maxAutoWriteItems?: number;
}

export interface DigestReconcilerResult {
    status: 'not-target' | 'no-op' | 'staged' | 'readback-passed' | 'write-unknown' | 'needs-review' | 'failed';
    bucketIds: string[];
    auditId?: string;
    lastError?: string;
}

function combineBucketIds(...groups: Array<string[] | undefined>): string[] {
    return [...new Set(groups.flatMap(group => group ?? []).filter(Boolean))];
}

function asSearchText(result: { text: string; touchesMetadata: boolean }): string {
    return `${result.text}${result.touchesMetadata ? ' [metadata-touch]' : ''}`;
}

async function defaultSearch(
    config: OmbreProviderConfig,
    query: string,
    fetchImpl?: typeof fetch,
): Promise<{ text: string; touchesMetadata: boolean }> {
    return callOmbreReadTool(config, 'breath_search', { query, max_results: 3 }, fetchImpl);
}

export async function reconcileOmbreDigestJob(
    job: OmbreDigestJob,
    deps: DigestReconcilerDeps,
): Promise<DigestReconcilerResult> {
    if (job.charId !== deps.targetCharId) {
        return { status: 'not-target', bucketIds: [] };
    }
    if (job.status !== 'checkpointed' && job.status !== 'reconciling' && job.status !== 'write-pending') {
        return { status: 'no-op', bucketIds: [] };
    }

    await deps.updateJob(job.id, { status: 'reconciling', updatedAt: deps.now() });

    const items = (job.newMemoryItems ?? []).slice(0, deps.maxAutoWriteItems ?? 5);
    if (items.length === 0) {
        await deps.updateJob(job.id, {
            status: 'readback-passed',
            readbackStatus: 'skipped-no-candidates',
            updatedAt: deps.now(),
        });
        return { status: 'readback-passed', bucketIds: [] };
    }

    const bucketIds: string[] = [];
    let auditId: string | undefined;
    let wroteAny = false;
    let stagedAny = false;

    for (const item of items) {
        const decision = evaluateDigestMemoryClaim(item);
        if (decision.action === 'blocked') {
            await deps.updateJob(job.id, {
                status: 'needs-review',
                lastError: `blocked-${decision.reason}`,
                updatedAt: deps.now(),
            });
            return { status: 'needs-review', bucketIds, lastError: `blocked-${decision.reason}` };
        }
        if (decision.action === 'skip') {
            continue;
        }
        if (decision.action === 'needs-review') {
            await deps.updateJob(job.id, {
                status: 'needs-review',
                lastError: `review-${decision.reason}`,
                updatedAt: deps.now(),
            });
            return { status: 'needs-review', bucketIds, lastError: `review-${decision.reason}` };
        }

        let effectiveItem = item;
        let effectiveDecision = decision;
        let stageSignature: string | undefined;

        if (decision.action === 'stage-candidate') {
            stageSignature = buildOmbreDigestStageSignature(item.claim);
            const stageWindow = await recordOmbreDigestStageCandidate({
                charId: job.charId,
                signature: stageSignature,
                localDate: job.localDate,
                claim: item.claim,
                sourceMessageIds: item.sourceMessageIds,
                importance: decision.importance,
                tags: decision.tags,
                dedupeQuery: decision.dedupeQuery,
                riskFlags: decision.riskFlags,
                now: deps.now(),
            });

            if (stageWindow.status !== 'promote' || !stageWindow.latestRecord) {
                stagedAny = true;
                continue;
            }

            const promotedRecord = stageWindow.latestRecord;
            effectiveItem = {
                claim: promotedRecord.claim,
                sourceMessageIds: [...promotedRecord.sourceMessageIds],
            };
            effectiveDecision = {
                ...decision,
                action: 'auto-write',
                reason: 'stage-promoted',
                importance: Math.max(decision.importance, promotedRecord.importance, 5),
                tags: [...new Set([...decision.tags, ...promotedRecord.tags, 'digest:stage-background'])],
                dedupeQuery: promotedRecord.dedupeQuery || decision.dedupeQuery,
                riskFlags: [...new Set([...decision.riskFlags, ...promotedRecord.riskFlags])],
            };
        }

        let search: { text: string; touchesMetadata: boolean };
        try {
            search = await (deps.search ?? ((query: string) => defaultSearch(deps.readbackConfig, query, deps.fetchImpl)))(effectiveDecision.dedupeQuery);
        } catch {
            await deps.updateJob(job.id, {
                status: 'needs-review',
                lastError: 'dedupe-failed',
                updatedAt: deps.now(),
            });
            return { status: 'needs-review', bucketIds, lastError: 'dedupe-failed' };
        }
        const duplicate = isDigestDuplicateSearchHit(effectiveItem.claim, asSearchText(search));
        if (duplicate.duplicate) {
            bucketIds.push(...duplicate.bucketIds);
            if (stageSignature) {
                await clearOmbreDigestStageCandidates({ charId: job.charId, signature: stageSignature });
            }
            continue;
        }

        const mapping = buildDigestHoldRequest(job, effectiveItem, effectiveDecision, stageSignature ? {
            extraTags: ['digest:stage-background'],
            whyRemembered: `Promoted from local stage pool after repeated observation across 4 days.`,
            meaning: `Promoted from a local 4-day action pool before confirmed hold.`,
        } : undefined);
        if (!mapping.ok) {
            await deps.updateJob(job.id, {
                status: 'needs-review',
                lastError: `mapping-${mapping.reason}`,
                updatedAt: deps.now(),
            });
            return { status: 'needs-review', bucketIds, lastError: `mapping-${mapping.reason}` };
        }

        await deps.updateJob(job.id, { status: 'write-pending', updatedAt: deps.now() });
        const workflow = await (deps.runHoldWorkflow ?? runOmbreConfirmedHoldWorkflow)({
            endpoint: deps.endpoint,
            readbackConfig: deps.readbackConfig,
            request: mapping.request,
            mappingAudit: mapping.audit,
            fetchImpl: deps.fetchImpl,
            storage: deps.storage,
        });

        if (!workflow.ok) {
            if (stageSignature && workflow.writeResult?.ok) {
                await clearOmbreDigestStageCandidates({ charId: job.charId, signature: stageSignature });
            }
            const status = workflow.readbackStatus === 'not-run' ? 'failed' : 'write-unknown';
            await deps.updateJob(job.id, {
                status,
                lastError: workflow.error ?? 'confirmed-workflow-failed',
                bucketIds: combineBucketIds(bucketIds, workflow.writeResult?.bucketId ? [workflow.writeResult.bucketId] : []),
                readbackStatus: workflow.readbackStatus,
                auditId: workflow.auditId,
                updatedAt: deps.now(),
            });
            return { status, bucketIds: combineBucketIds(bucketIds, workflow.writeResult?.bucketId ? [workflow.writeResult.bucketId] : []), auditId: workflow.auditId, lastError: workflow.error };
        }

        wroteAny = true;
        if (workflow.writeResult?.bucketId) bucketIds.push(workflow.writeResult.bucketId);
        auditId = workflow.auditId ?? auditId;
        if (stageSignature) {
            await clearOmbreDigestStageCandidates({ charId: job.charId, signature: stageSignature });
        }
    }

    const uniqueBucketIds = bucketIds.filter(Boolean);
    if (stagedAny && !wroteAny && uniqueBucketIds.length === 0) {
        await deps.updateJob(job.id, {
            status: 'stage-candidate',
            readbackStatus: 'staged',
            updatedAt: deps.now(),
            lastError: undefined,
        });
        return {
            status: 'staged',
            bucketIds: [],
            auditId,
        };
    }

    await deps.updateJob(job.id, {
        status: 'readback-passed',
        bucketIds: uniqueBucketIds.length > 0 ? uniqueBucketIds : undefined,
        readbackStatus: wroteAny ? 'passed' : uniqueBucketIds.length > 0 ? 'already-present' : 'skipped-no-candidates',
        auditId,
        updatedAt: deps.now(),
        lastError: undefined,
    });
    return {
        status: 'readback-passed',
        bucketIds: uniqueBucketIds,
        auditId,
    };
}

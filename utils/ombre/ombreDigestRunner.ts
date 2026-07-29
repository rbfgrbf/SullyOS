import type { Message } from '../../types';
import { DB } from '../db';
import { parseDigestModelOutput, requestOmbreDigest } from './ombreDigestBridgeClient';
import {
    getLatestCompletedOmbreDigestJob,
    listOmbreDigestJobs,
    putOmbreDigestJob,
    updateOmbreDigestJob,
} from './ombreDigestDb';
import type {
    DigestBridgeRequest,
    DigestModelOutput,
    DigestTriggerReason,
    OmbreDigestJob,
} from './ombreDigestTypes';
import { planNextDigestSegment } from './ombreDigestPlanner';
import { reconcileOmbreDigestJob, type DigestReconcilerResult } from './ombreDigestReconciler';
import type { OmbreProviderConfig } from './ombreTypes';

export interface OmbreDigestConfig {
    targetCharId: string;
    mode: 'off' | 'dry-run';
    autoWriteMode: 'off' | 'confirmed';
    bridgeEndpoint: string;
    mcpEndpoint: string;
    roundThreshold: number;
    maxSourceChars: number;
    maxEstimatedTokens: number;
    periodBoundariesMinutes: number[];
    maxAttempts: number;
    maxAutoWriteItems: number;
}

export interface DigestRunnerReconcileInput {
    job: OmbreDigestJob;
    config: OmbreDigestConfig;
    now: () => number;
    updateJob: typeof updateOmbreDigestJob;
}

export interface DigestRunnerDeps {
    now: () => number;
    timeZone?: string;
    loadConfig: () => OmbreDigestConfig;
    getMessages: (charId: string) => Promise<Message[]>;
    listJobs: typeof listOmbreDigestJobs;
    getLatestJob: typeof getLatestCompletedOmbreDigestJob;
    putJob: typeof putOmbreDigestJob;
    updateJob: typeof updateOmbreDigestJob;
    summarize: (request: DigestBridgeRequest, options?: { endpoint?: string }) => Promise<DigestModelOutput>;
    reconcile: (input: DigestRunnerReconcileInput) => Promise<DigestReconcilerResult>;
}

export interface DigestRunResult {
    status: 'disabled' | 'not-target' | 'no-op' | 'checkpointed' | 'staged' | 'readback-passed' | 'write-unknown' | 'needs-review' | 'failed';
    jobId?: string;
    sourceEndMessageId?: number;
    errorCode?: string;
}

function digestReadbackConfig(endpoint: string): OmbreProviderConfig {
    return {
        enabled: true,
        corePrompt: 'core',
        mcpEndpoint: endpoint,
        memoryRecallMode: 'search',
        memoryWriteMode: 'off',
        maxResults: 3,
        maxMemoryChars: 1200,
        strictNoTouch: false,
    };
}

export const defaultDigestRunnerDeps: DigestRunnerDeps = {
    now: () => Date.now(),
    loadConfig: () => ({
        targetCharId: 'char-1785035659785',
        mode: 'dry-run',
        autoWriteMode: 'confirmed',
        bridgeEndpoint: 'http://127.0.0.1:17874',
        mcpEndpoint: 'http://127.0.0.1:18001/mcp',
        roundThreshold: 50,
        maxSourceChars: 48_000,
        maxEstimatedTokens: 12_000,
        periodBoundariesMinutes: [720, 1080, 1440],
        maxAttempts: 3,
        maxAutoWriteItems: 5,
    }),
    getMessages: (charId) => DB.getMessagesByCharId(charId, true),
    listJobs: listOmbreDigestJobs,
    getLatestJob: getLatestCompletedOmbreDigestJob,
    putJob: putOmbreDigestJob,
    updateJob: updateOmbreDigestJob,
    summarize: requestOmbreDigest,
    reconcile: ({ job, config, now, updateJob }) => reconcileOmbreDigestJob(job, {
        targetCharId: config.targetCharId,
        endpoint: config.mcpEndpoint,
        readbackConfig: digestReadbackConfig(config.mcpEndpoint),
        now,
        updateJob,
        maxAutoWriteItems: config.maxAutoWriteItems,
    }),
};

function toBridgeRequest(jobId: string, charId: string, localDate: string, messages: Message[]): DigestBridgeRequest {
    return {
        protocolVersion: 1,
        jobId,
        charId,
        localDate,
        messages: messages.map(message => ({
            id: message.id,
            role: message.role as 'user' | 'assistant',
            type: String(message.type),
            timestamp: message.timestamp,
            content: message.content,
        })),
    };
}

function safeErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('timeout')) return 'bridge-timeout';
    if (message.includes('schema')) return 'bridge-schema';
    if (message.includes('http 401') || message.includes('http 403') || message.includes('auth')) return 'bridge-auth';
    return 'bridge-error';
}

function isRecoverableConfirmedWriteSessionFailure(job: OmbreDigestJob, maxAttempts: number): boolean {
    const error = (job.lastError || '').toLocaleLowerCase();
    return job.status === 'failed'
        && job.attempts <= maxAttempts + 1
        && error.includes('missing session');
}

export async function runOmbreDigestCheck(
    charId: string,
    reason: DigestTriggerReason,
    deps: DigestRunnerDeps,
): Promise<DigestRunResult> {
    const config = deps.loadConfig();
    if (charId !== config.targetCharId) return { status: 'not-target' };
    if (config.mode === 'off') return { status: 'disabled' };

    if (config.autoWriteMode === 'confirmed') {
        const pendingReconcile = (await deps.listJobs(charId, ['checkpointed', 'reconciling', 'write-pending']))
            .sort((a, b) => a.sourceEndMessageId - b.sourceEndMessageId)[0];
        if (pendingReconcile) {
            const reconciled = await deps.reconcile({ job: pendingReconcile, config, now: deps.now, updateJob: deps.updateJob });
            return {
                status: reconciled.status,
                jobId: pendingReconcile.id,
                sourceEndMessageId: pendingReconcile.sourceEndMessageId,
                errorCode: reconciled.lastError,
            };
        }

        const recoverableFailed = (await deps.listJobs(charId, ['failed']))
            .filter(job => isRecoverableConfirmedWriteSessionFailure(job, config.maxAttempts))
            .sort((a, b) => a.sourceEndMessageId - b.sourceEndMessageId)[0];
        if (recoverableFailed) {
            const recovered = await deps.updateJob(recoverableFailed.id, {
                status: 'checkpointed',
                attempts: recoverableFailed.attempts + 1,
                lastError: undefined,
                updatedAt: deps.now(),
            });
            const reconciled = await deps.reconcile({ job: recovered, config, now: deps.now, updateJob: deps.updateJob });
            return {
                status: reconciled.status,
                jobId: recoverableFailed.id,
                sourceEndMessageId: recoverableFailed.sourceEndMessageId,
                errorCode: reconciled.lastError,
            };
        }
    }

    const messages = await deps.getMessages(charId);
    const latest = await deps.getLatestJob(charId);
    const lastProcessedMessageId = latest?.sourceEndMessageId || 0;
    const plan = await planNextDigestSegment({
        messages,
        lastProcessedMessageId,
        reason,
        config,
        now: deps.now(),
        timeZone: deps.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    if (!plan) return { status: 'no-op' };

    const existing = (await deps.listJobs(charId)).find(job => job.id === plan.jobId);
    if (existing?.status === 'checkpointed' && config.autoWriteMode === 'confirmed') {
        const reconciled = await deps.reconcile({ job: existing, config, now: deps.now, updateJob: deps.updateJob });
        return { status: reconciled.status, jobId: existing.id, sourceEndMessageId: existing.sourceEndMessageId, errorCode: reconciled.lastError };
    }
    if (existing?.status === 'checkpointed' || existing?.status === 'stage-candidate' || existing?.status === 'written' || existing?.status === 'readback-passed' || existing?.status === 'write-unknown' || existing?.status === 'needs-review') {
        const status = existing.status === 'written' ? 'readback-passed' : existing.status;
        return { status: status === 'stage-candidate' ? 'staged' : status, jobId: existing.id, sourceEndMessageId: existing.sourceEndMessageId, errorCode: existing.lastError };
    }
    if ((existing?.attempts || 0) >= config.maxAttempts) {
        return { status: 'failed', jobId: plan.jobId, sourceEndMessageId: plan.sourceEndMessageId, errorCode: 'max-attempts' };
    }

    const now = deps.now();
    const pending: OmbreDigestJob = {
        id: plan.jobId,
        charId,
        localDate: plan.periodKey.slice(0, 10),
        periodKey: plan.periodKey,
        sourceStartMessageId: plan.sourceStartMessageId,
        sourceEndMessageId: plan.sourceEndMessageId,
        sourceMessageCount: plan.sourceMessageCount,
        sourceHash: plan.sourceHash,
        triggerReason: reason,
        status: 'pending',
        attempts: (existing?.attempts || 0) + 1,
        updatedAt: now,
    };
    await deps.putJob(pending);

    try {
        await deps.updateJob(plan.jobId, { status: 'summarizing', updatedAt: deps.now() });
        const output = parseDigestModelOutput(await deps.summarize(
            toBridgeRequest(plan.jobId, charId, pending.localDate, plan.sourceMessages),
            { endpoint: config.bridgeEndpoint },
        ));
        const checkpointed = await deps.updateJob(plan.jobId, {
            status: 'checkpointed',
            storedClaims: output.storedClaims,
            newMemoryItems: output.newMemoryItems,
            segmentSummary: output.segmentSummary,
            dailySummary: output.dailySummary,
            updatedAt: deps.now(),
            lastError: undefined,
        });
        if (config.autoWriteMode === 'confirmed') {
            const reconciled = await deps.reconcile({ job: checkpointed, config, now: deps.now, updateJob: deps.updateJob });
            return { status: reconciled.status, jobId: plan.jobId, sourceEndMessageId: plan.sourceEndMessageId, errorCode: reconciled.lastError };
        }
        return { status: 'checkpointed', jobId: plan.jobId, sourceEndMessageId: plan.sourceEndMessageId };
    } catch (error) {
        const errorCode = safeErrorCode(error);
        await deps.updateJob(plan.jobId, {
            status: 'failed',
            lastError: errorCode,
            updatedAt: deps.now(),
        });
        return { status: 'failed', jobId: plan.jobId, sourceEndMessageId: plan.sourceEndMessageId, errorCode };
    }
}

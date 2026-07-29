export type DigestTriggerReason = 'round-threshold' | 'size-threshold' | 'period-boundary' | 'startup-recovery';

export type DigestJobStatus =
    | 'pending'
    | 'summarizing'
    | 'checkpointed'
    | 'stage-candidate'
    | 'reconciling'
    | 'write-pending'
    | 'written'
    | 'readback-passed'
    | 'write-unknown'
    | 'failed'
    | 'needs-review';

export interface DigestTriggerConfig {
    roundThreshold: number;
    maxSourceChars: number;
    maxEstimatedTokens: number;
    periodBoundariesMinutes: number[];
}

export interface DigestClaim {
    claim: string;
    sourceMessageIds: Array<number | string>;
}

export interface DigestModelOutput {
    storedClaims: DigestClaim[];
    newMemoryItems: DigestClaim[];
    segmentSummary: string;
    dailySummary?: string;
    excluded: string[];
}

export interface OmbreDigestJob {
    id: string;
    charId: string;
    localDate: string;
    periodKey: string;
    sourceStartMessageId: number;
    sourceEndMessageId: number;
    sourceMessageCount: number;
    sourceHash: string;
    triggerReason: DigestTriggerReason;
    status: DigestJobStatus;
    attempts: number;
    updatedAt: number;
    lastError?: string;
    storedClaims?: DigestClaim[];
    newMemoryItems?: DigestClaim[];
    segmentSummary?: string;
    dailySummary?: string;
    bucketIds?: string[];
    readbackStatus?: string;
    auditId?: string;
}

export interface DigestBridgeMessage {
    id: number;
    role: 'user' | 'assistant';
    type: string;
    timestamp: number;
    content: string;
}

export interface DigestBridgeRequest {
    protocolVersion: 1;
    jobId: string;
    charId: string;
    localDate: string;
    messages: DigestBridgeMessage[];
}

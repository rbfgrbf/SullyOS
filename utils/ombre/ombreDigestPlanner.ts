import type { Message } from '../../types';
import {
    buildDigestJobKey,
    computeDigestSourceHash,
    countCompletedRounds,
    estimateDigestChars,
    type DigestTriggerConfig,
    type DigestTriggerReason,
} from './ombreDigestPolicy';

export interface DigestSegmentPlan {
    sourceStartMessageId: number;
    sourceEndMessageId: number;
    sourceMessages: Message[];
    sourceMessageCount: number;
    sourceHash: string;
    triggerReason: DigestTriggerReason;
    periodKey: string;
    jobId: string;
}

function localDateParts(timestamp: number, timeZone: string): { date: string; minutes: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]));
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: hour * 60 + minute,
    };
}

export function getLocalPeriodKey(timestamp: number, timeZone: string, boundaries: number[] = [720, 1080, 1440]): string {
    const { date, minutes } = localDateParts(timestamp, timeZone);
    const boundary = [...boundaries].sort((a, b) => a - b).find(value => minutes < value);
    const periodEnd = boundary ?? 1440;
    const starts = [...boundaries].sort((a, b) => a - b).filter(value => value <= minutes);
    const periodStart = starts.length > 0 ? starts[starts.length - 1] : 0;
    return `${date}#${String(periodStart).padStart(4, '0')}-${String(periodEnd).padStart(4, '0')}`;
}

function completedPairs(messages: Message[]): Message[][] {
    const pairs: Message[][] = [];
    let pendingUsers: Message[] = [];

    for (const message of messages) {
        if (message.role === 'user') {
            pendingUsers.push(message);
        } else if (message.role === 'assistant' && pendingUsers.length > 0) {
            pairs.push([...pendingUsers, message]);
            pendingUsers = [];
        }
    }

    return pairs;
}

export async function planNextDigestSegment(input: {
    messages: Message[];
    lastProcessedMessageId: number;
    reason: DigestTriggerReason;
    config: DigestTriggerConfig;
    now: number;
    timeZone: string;
}): Promise<DigestSegmentPlan | null> {
    const pending = input.messages
        .filter(message => message.id > input.lastProcessedMessageId && (message.role === 'user' || message.role === 'assistant'))
        .sort((a, b) => a.id - b.id);
    const pairs = completedPairs(pending);
    if (pairs.length === 0) return null;

    const totalChars = estimateDigestChars(pending);
    const totalEstimatedTokens = Math.ceil(totalChars / 4);
    const thresholdReached = pairs.length >= input.config.roundThreshold;
    const sizeReached = totalChars >= input.config.maxSourceChars || totalEstimatedTokens >= input.config.maxEstimatedTokens;
    const currentPeriodKey = getLocalPeriodKey(
        input.now,
        input.timeZone,
        input.config.periodBoundariesMinutes,
    );
    const isPeriodReason = input.reason === 'period-boundary' || input.reason === 'startup-recovery';
    const previousPeriodPairs = pairs.filter(pair => getLocalPeriodKey(
        pair[pair.length - 1].timestamp,
        input.timeZone,
        input.config.periodBoundariesMinutes,
    ) !== currentPeriodKey);
    const eligiblePairs = isPeriodReason && previousPeriodPairs.length > 0 ? previousPeriodPairs : pairs;
    const canSeal = isPeriodReason && previousPeriodPairs.length > 0;
    if (!thresholdReached && !sizeReached && !canSeal) return null;

    const targetPairCount = thresholdReached && input.reason === 'round-threshold'
        ? input.config.roundThreshold
        : eligiblePairs.length;
    const selectedPairs: Message[][] = [];
    let selectedChars = 0;
    let selectedTokens = 0;

    for (const pair of eligiblePairs) {
        if (selectedPairs.length >= targetPairCount) break;
        const pairChars = estimateDigestChars(pair);
        const pairTokens = Math.ceil(pairChars / 4);
        const exceedsLimit = selectedPairs.length > 0 && (
            selectedChars + pairChars > input.config.maxSourceChars ||
            selectedTokens + pairTokens > input.config.maxEstimatedTokens
        );
        if (exceedsLimit) break;
        selectedPairs.push(pair);
        selectedChars += pairChars;
        selectedTokens += pairTokens;
    }

    if (selectedPairs.length === 0) return null;
    const sourceMessages = selectedPairs.flat();
    const sourceHash = await computeDigestSourceHash(sourceMessages);
    const sourceStartMessageId = sourceMessages[0].id;
    const sourceEndMessageId = sourceMessages[sourceMessages.length - 1].id;
    const periodKey = currentPeriodKey;

    return {
        sourceStartMessageId,
        sourceEndMessageId,
        sourceMessages,
        sourceMessageCount: sourceMessages.length,
        sourceHash,
        triggerReason: input.reason,
        periodKey,
        jobId: buildDigestJobKey({
            charId: pending[0].charId,
            localDate: periodKey.slice(0, 10),
            sourceStartMessageId,
            sourceEndMessageId,
            sourceHash,
        }),
    };
}

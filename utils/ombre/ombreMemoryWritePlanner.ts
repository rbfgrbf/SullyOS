import type { Message } from '../../types';
import type { OmbreMemoryBlock, OmbreMemoryPlan, OmbrePromptProviderInput } from './ombreTypes';

const MIN_DIRECT_MEMORY_CHARS = 12;
const MAX_DIRECT_HOLD_CHARS = 700;
const MAX_DEDUPE_QUERY_CHARS = 240;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function latestMessage(input: OmbrePromptProviderInput): Message | undefined {
  return input.recentMsgsHint.at(-1);
}

function stableMessageIds(message: Message | undefined): Array<number | string> {
  if (!message) return [];
  return typeof message.id === 'number' || typeof message.id === 'string' ? [message.id] : [];
}

function buildSource(input: OmbrePromptProviderInput, message: Message | undefined) {
  return {
    app: 'SullyOS' as const,
    feature: input.feature,
    charId: input.char?.id,
    groupId: message?.groupId,
    messageIds: stableMessageIds(message),
    timestamp: message?.timestamp,
  };
}

function buildDedupeQuery(text: string): string {
  return text.length > MAX_DEDUPE_QUERY_CHARS ? text.slice(0, MAX_DEDUPE_QUERY_CHARS).trimEnd() : text;
}

function hasPossiblePrivateData(text: string): boolean {
  return /https?:\/\//i.test(text) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
    /\b\d{6,}\b/.test(text);
}

function hasRecalledBucket(memoryBlocks: OmbreMemoryBlock[]): boolean {
  return memoryBlocks.some(block => block.bucketIds.length > 0);
}

export function buildOmbreMemoryWritePlan(
  input: OmbrePromptProviderInput,
  memoryBlocks: OmbreMemoryBlock[] = [],
): OmbreMemoryPlan {
  const mode = input.config.memoryWriteMode;
  if (!input.config.enabled || mode === 'off') return { mode: 'off', riskFlags: [] };

  if (mode === 'confirmed') {
    return {
      mode: 'off',
      reason: 'Confirmed Ombre writes are blocked in this provider stage.',
      riskFlags: ['confirmed-write-blocked'],
    };
  }

  const message = latestMessage(input);
  const source = buildSource(input, message);
  const approval = { required: true, status: 'pending' as const, gate: 'dry-run' as const };
  const riskFlags = ['dry-run-not-written'];
  const content = normalizeText(message?.content);

  if (message?.role !== 'user' || content.length < MIN_DIRECT_MEMORY_CHARS) {
    return {
      mode: 'dry-run',
      reason: 'No current user-authored memory candidate was found.',
      source,
      approval,
      riskFlags: [...riskFlags, 'no-current-user-memory-candidate'],
    };
  }

  const dedupeQuery = buildDedupeQuery(content);

  if (content.length > MAX_DIRECT_HOLD_CHARS) {
    return {
      mode: 'dry-run',
      reason: 'Current user text is too long for direct hold; summarize and review it before any confirmed write.',
      source,
      dedupeQuery,
      approval,
      riskFlags: [...riskFlags, 'content-too-long-for-direct-hold', 'needs-human-summarization'],
    };
  }

  if (hasPossiblePrivateData(content)) riskFlags.push('possible-private-data');
  if (hasRecalledBucket(memoryBlocks)) riskFlags.push('dedupe-against-recalled-buckets');
  if (input.feature !== 'chat') riskFlags.push('non-chat-source-review');

  return {
    mode: 'dry-run',
    proposedTool: 'hold',
    arguments: {
      content,
      tags: ['sullyos', `feature:${input.feature}`],
      importance: 4,
      pinned: false,
      test_data: true,
      why_remembered: 'Dry-run proposal from SullyOS. Human approval is required before confirmed write.',
      meaning: 'Candidate memory from the latest user-authored SullyOS message.',
    },
    reason: 'Candidate user-authored SullyOS message prepared for review only.',
    source,
    expectedBucketType: 'dynamic',
    dedupeQuery,
    approval,
    riskFlags,
  };
}

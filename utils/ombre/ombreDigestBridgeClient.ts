import type { Message } from '../../types';
import type { DigestBridgeMessage, DigestBridgeRequest, DigestModelOutput } from './ombreDigestTypes';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:17874';
const MAX_MESSAGES = 200;
const MAX_CHARS_PER_MESSAGE = 12_000;

function redactSensitiveText(value: string): string {
    return value
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]');
}

function containsSensitiveString(value: unknown): boolean {
    if (typeof value === 'string') {
        return /\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/i.test(value);
    }
    if (Array.isArray(value)) return value.some(containsSensitiveString);
    if (value && typeof value === 'object') return Object.values(value).some(containsSensitiveString);
    return false;
}

export function sanitizeDigestMessages(messages: Message[], limits: {
    maxMessages: number;
    maxCharsPerMessage: number;
}): DigestBridgeMessage[] {
    return messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .slice(0, limits.maxMessages)
        .map(message => ({
            id: message.id,
            role: message.role as 'user' | 'assistant',
            type: String(message.type),
            timestamp: message.timestamp,
            content: redactSensitiveText(message.content).slice(0, limits.maxCharsPerMessage),
        }));
}

function parseClaim(value: unknown, field: string): { claim: string; sourceMessageIds: Array<number | string> } {
    if (!value || typeof value !== 'object') throw new Error(`Digest bridge schema: ${field} item must be an object`);
    const item = value as Record<string, unknown>;
    if (typeof item.claim !== 'string' || !item.claim.trim()) throw new Error(`Digest bridge schema: ${field}.claim`);
    if (!Array.isArray(item.sourceMessageIds) || item.sourceMessageIds.length === 0 || item.sourceMessageIds.some(id => !['number', 'string'].includes(typeof id))) {
        throw new Error(`Digest bridge schema: ${field}.sourceMessageIds`);
    }
    return { claim: item.claim, sourceMessageIds: item.sourceMessageIds as Array<number | string> };
}

export function parseDigestModelOutput(value: unknown): DigestModelOutput {
    if (!value || typeof value !== 'object' || containsSensitiveString(value)) {
        throw new Error('Digest bridge schema: invalid or sensitive output');
    }
    const output = value as Record<string, unknown>;
    if (!Array.isArray(output.storedClaims) || !Array.isArray(output.newMemoryItems) || !Array.isArray(output.excluded)) {
        throw new Error('Digest bridge schema: required arrays missing');
    }
    if (typeof output.segmentSummary !== 'string') throw new Error('Digest bridge schema: segmentSummary');
    if (output.dailySummary !== undefined && typeof output.dailySummary !== 'string') {
        throw new Error('Digest bridge schema: dailySummary');
    }
    return {
        storedClaims: output.storedClaims.map((item, index) => parseClaim(item, `storedClaims[${index}]`)),
        newMemoryItems: output.newMemoryItems.map((item, index) => parseClaim(item, `newMemoryItems[${index}]`)),
        segmentSummary: output.segmentSummary,
        dailySummary: output.dailySummary as string | undefined,
        excluded: output.excluded.map((item, index) => {
            if (typeof item !== 'string') throw new Error(`Digest bridge schema: excluded[${index}]`);
            return item;
        }),
    };
}

export async function requestOmbreDigest(
    input: DigestBridgeRequest,
    options: { endpoint?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<DigestModelOutput> {
    const fetchImpl = options.fetchImpl || fetch;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 90_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = JSON.stringify({
        ...input,
        messages: sanitizeDigestMessages(input.messages as Message[], {
            maxMessages: MAX_MESSAGES,
            maxCharsPerMessage: MAX_CHARS_PER_MESSAGE,
        }),
    });

    try {
        let response: Response;
        try {
            response = await fetchImpl(`${options.endpoint || DEFAULT_ENDPOINT}/v1/ombre/digest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body,
                signal: controller.signal,
            });
        } catch (error) {
            if (controller.signal.aborted) throw new Error('Digest bridge timeout');
            throw new Error(`Digest bridge request failed: ${error instanceof Error ? error.message : 'network error'}`);
        }
        if (!response.ok) throw new Error(`Digest bridge HTTP ${response.status}`);
        let responseBody: unknown;
        try {
            responseBody = await response.json();
        } catch {
            throw new Error('Digest bridge returned invalid JSON');
        }
        return parseDigestModelOutput(responseBody);
    } finally {
        clearTimeout(timeout);
    }
}

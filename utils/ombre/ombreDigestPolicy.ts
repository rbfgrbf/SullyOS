import type { Message } from '../../types';
export type { DigestTriggerConfig, DigestTriggerReason } from './ombreDigestTypes';

export function countCompletedRounds(messages: Message[]): number {
    let rounds = 0;
    let waitingForAssistant = false;

    for (const message of messages) {
        if (message.role === 'user') {
            waitingForAssistant = true;
        } else if (message.role === 'assistant' && waitingForAssistant) {
            rounds += 1;
            waitingForAssistant = false;
        }
    }

    return rounds;
}

export function estimateDigestChars(messages: Message[]): number {
    return messages.reduce((total, message) => total + message.content.length, 0);
}

function stableSerializeMessage(message: Message): string {
    return JSON.stringify([
        message.id,
        message.role,
        message.type,
        message.timestamp,
        message.content,
    ]);
}

export async function computeDigestSourceHash(messages: Message[]): Promise<string> {
    const payload = messages.map(stableSerializeMessage).join('\n');
    const encoded = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function buildDigestJobKey(input: {
    charId: string;
    localDate: string;
    sourceStartMessageId: number;
    sourceEndMessageId: number;
    sourceHash: string;
}): string {
    return [
        input.charId,
        input.localDate,
        input.sourceStartMessageId,
        input.sourceEndMessageId,
        input.sourceHash,
    ].join(':');
}

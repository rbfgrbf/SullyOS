import type { OmbreConfirmedReadbackResult } from './ombreConfirmedReadback';
import type { OmbreConfirmedHoldRequest, OmbreConfirmedWriteResult } from './ombreConfirmedWriteClient';
import type { OmbreConfirmedHoldMappingAudit } from './ombreConfirmedWriteMapper';

export const OMBRE_CONFIRMED_WRITE_AUDIT_KEY = 'ombre_confirmed_write_audit_v1';

export interface OmbreConfirmedWriteAuditEntry {
  id: string;
  createdAt: number;
  charId?: string;
  feature: string;
  sourceMessageIds: Array<number | string>;
  tool: 'hold';
  bucketId?: string;
  contentHash: string;
  contentPreview: string;
  riskFlags: string[];
  dedupeTouchedMetadata: boolean;
  readbackStatus: 'not-run' | 'passed' | 'failed';
  endpointKind: 'loopback-mcp' | 'loopback-proxy';
  status: 'queued' | 'written' | 'write-failed' | 'write-succeeded-readback-failed';
}

export interface BuildOmbreConfirmedWriteAuditEntryInput {
  id?: string;
  now?: number;
  charId?: string;
  feature: string;
  sourceMessageIds: Array<number | string>;
  tool?: 'hold';
  bucketId?: string;
  content: string;
  riskFlags?: string[];
  dedupeTouchedMetadata?: boolean;
  readbackStatus?: OmbreConfirmedWriteAuditEntry['readbackStatus'];
  endpointKind?: OmbreConfirmedWriteAuditEntry['endpointKind'];
  status?: OmbreConfirmedWriteAuditEntry['status'];
}

export interface BuildFinalOmbreConfirmedWriteAuditEntryInput {
  id?: string;
  now?: number;
  request: OmbreConfirmedHoldRequest;
  mappingAudit: OmbreConfirmedHoldMappingAudit;
  writeResult?: OmbreConfirmedWriteResult;
  writeError?: unknown;
  readbackResult?: OmbreConfirmedReadbackResult;
  endpointKind?: OmbreConfirmedWriteAuditEntry['endpointKind'];
}

const SECRET_REDACTIONS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted-secret]'],
  [/\b(api[_ -]?key|apikey|secret[_ -]?key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted-secret]'],
  [/\b(password|passwd|pwd)\b\s*[:=]\s*[^\s,;]+(?:\s+[^\s,;]+){0,5}/gi, '$1=[redacted-secret]'],
  [/\b(verification|auth|login)\s+code\b\s*[:=]?\s*[A-Za-z0-9_-]+/gi, '$1 code [redacted-secret]'],
  [/\brecovery\s+code\b\s*[:=]?\s*[A-Za-z0-9_-]+(?:[\s-]+[A-Za-z0-9_-]+){0,5}/gi, 'recovery code [redacted-secret]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/gi, 'sk-[redacted-secret]'],
  [/\u5bc6\u7801\s*[:\uff1a\u662f=]?\s*[^\s,;]+/g, '\u5bc6\u7801[redacted-secret]'],
  [/\u9a8c\u8bc1\u7801\s*[:\uff1a\u662f=]?\s*\d{4,}/g, '\u9a8c\u8bc1\u7801[redacted-secret]'],
  [/\u6062\u590d\u7801\s*[:\uff1a\u662f=]?\s*[^\s,;]+/g, '\u6062\u590d\u7801[redacted-secret]'],
];

function unique(items: string[]): string[] {
  return [...new Set(items.filter(item => item.trim().length > 0))];
}

function normalizedPreview(content: string): string {
  const redacted = SECRET_REDACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    content.replace(/\s+/g, ' ').trim(),
  );
  return [...redacted].slice(0, 80).join('');
}

function stableHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `hash:v1:${hash.toString(16).padStart(8, '0')}`;
}

export function buildOmbreConfirmedWriteAuditEntry(
  input: BuildOmbreConfirmedWriteAuditEntryInput,
): OmbreConfirmedWriteAuditEntry {
  const createdAt = input.now ?? Date.now();
  const contentHash = stableHash(input.content);
  return {
    id: input.id ?? `ombre-confirmed-audit-${createdAt}-${contentHash.slice(-8)}`,
    createdAt,
    charId: input.charId,
    feature: input.feature,
    sourceMessageIds: [...input.sourceMessageIds],
    tool: 'hold',
    bucketId: input.bucketId,
    contentHash,
    contentPreview: normalizedPreview(input.content),
    riskFlags: unique(input.riskFlags ?? []),
    dedupeTouchedMetadata: input.dedupeTouchedMetadata === true,
    readbackStatus: input.readbackStatus ?? 'not-run',
    endpointKind: input.endpointKind ?? 'loopback-mcp',
    status: input.status ?? 'queued',
  };
}

export function buildFinalOmbreConfirmedWriteAuditEntry(
  input: BuildFinalOmbreConfirmedWriteAuditEntryInput,
): OmbreConfirmedWriteAuditEntry {
  const source = input.mappingAudit.source;
  const writeSucceeded = input.writeResult?.ok === true && !input.writeError;
  const readbackStatus: OmbreConfirmedWriteAuditEntry['readbackStatus'] = !writeSucceeded
    ? 'not-run'
    : input.readbackResult?.ok === true ? 'passed' : 'failed';
  const status: OmbreConfirmedWriteAuditEntry['status'] = !writeSucceeded
    ? 'write-failed'
    : readbackStatus === 'passed' ? 'written' : 'write-succeeded-readback-failed';
  const riskFlags = [
    ...(input.mappingAudit.dryRunRiskFlags ?? []),
    ...(status === 'write-failed' ? ['confirmed-write-failed'] : []),
    ...(status === 'write-succeeded-readback-failed' ? ['confirmed-readback-failed'] : []),
  ];

  return buildOmbreConfirmedWriteAuditEntry({
    id: input.id,
    now: input.now,
    charId: source?.charId,
    feature: source?.feature ?? 'utility',
    sourceMessageIds: source?.messageIds ?? [],
    bucketId: input.writeResult?.bucketId ?? input.readbackResult?.bucketId,
    content: input.request.content,
    riskFlags,
    dedupeTouchedMetadata: input.readbackResult?.touchedMetadata === true,
    readbackStatus,
    endpointKind: input.endpointKind,
    status,
  });
}

export function loadOmbreConfirmedWriteAuditEntries(
  storage: Storage = globalThis.localStorage,
): OmbreConfirmedWriteAuditEntry[] {
  const raw = storage.getItem(OMBRE_CONFIRMED_WRITE_AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as OmbreConfirmedWriteAuditEntry[] : [];
  } catch {
    return [];
  }
}

export function saveOmbreConfirmedWriteAuditEntries(
  entries: OmbreConfirmedWriteAuditEntry[],
  storage: Storage = globalThis.localStorage,
): void {
  storage.setItem(OMBRE_CONFIRMED_WRITE_AUDIT_KEY, JSON.stringify(entries));
}

export function appendOmbreConfirmedWriteAuditEntry(
  entry: OmbreConfirmedWriteAuditEntry,
  storage: Storage = globalThis.localStorage,
): OmbreConfirmedWriteAuditEntry[] {
  const entries = [...loadOmbreConfirmedWriteAuditEntries(storage), entry];
  saveOmbreConfirmedWriteAuditEntries(entries, storage);
  return entries;
}

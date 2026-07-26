import { describe, expect, it } from 'vitest';
import {
  appendOmbreConfirmedWriteAuditEntry,
  buildOmbreConfirmedWriteAuditEntry,
  buildFinalOmbreConfirmedWriteAuditEntry,
  loadOmbreConfirmedWriteAuditEntries,
  OMBRE_CONFIRMED_WRITE_AUDIT_KEY,
} from './ombreConfirmedWriteAudit';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

describe('Ombre confirmed write audit', () => {
  it('builds a local audit entry with source ids, bucket id, status, and readback metadata', () => {
    const entry = buildOmbreConfirmedWriteAuditEntry({
      id: 'audit-1',
      now: 1_785_040_000_000,
      charId: 'char-xiaoguai',
      feature: 'chat',
      sourceMessageIds: [101, '102b'],
      tool: 'hold',
      bucketId: '5202cd96db58',
      content: 'Remember that confirmed memories need readback and audit.',
      riskFlags: ['dry-run-not-written', 'dry-run-not-written'],
      dedupeTouchedMetadata: true,
      readbackStatus: 'passed',
      endpointKind: 'loopback-mcp',
      status: 'written',
    });

    expect(entry).toEqual({
      id: 'audit-1',
      createdAt: 1_785_040_000_000,
      charId: 'char-xiaoguai',
      feature: 'chat',
      sourceMessageIds: [101, '102b'],
      tool: 'hold',
      bucketId: '5202cd96db58',
      contentHash: expect.stringMatching(/^hash:v1:/),
      contentPreview: 'Remember that confirmed memories need readback and audit.',
      riskFlags: ['dry-run-not-written'],
      dedupeTouchedMetadata: true,
      readbackStatus: 'passed',
      endpointKind: 'loopback-mcp',
      status: 'written',
    });
  });

  it('keeps preview at 80 characters and never stores full secret material', () => {
    const secret = 'password: correct horse battery staple and Bearer live-token-123456789 with extra text '.repeat(3);
    const entry = buildOmbreConfirmedWriteAuditEntry({
      content: secret,
      feature: 'chat',
      sourceMessageIds: [201],
      riskFlags: ['possible-secret-content'],
    });

    expect([...entry.contentPreview].length).toBeLessThanOrEqual(80);
    expect(entry.contentPreview).not.toContain('correct horse battery staple');
    expect(entry.contentPreview).not.toMatch(/Bearer\s+live-token/i);
    expect(JSON.stringify(entry)).not.toContain(secret);
    expect(entry.contentHash).not.toContain('password');
  });

  it('can append and load audit entries from injected local storage', () => {
    const storage = memoryStorage();
    const entry = buildOmbreConfirmedWriteAuditEntry({
      id: 'audit-store-1',
      now: 1,
      content: 'Remember that local audit entries are stored separately.',
      feature: 'chat',
      sourceMessageIds: [301],
    });

    appendOmbreConfirmedWriteAuditEntry(entry, storage);
    const raw = storage.getItem(OMBRE_CONFIRMED_WRITE_AUDIT_KEY);

    expect(raw).toContain('audit-store-1');
    expect(loadOmbreConfirmedWriteAuditEntries(storage)).toEqual([entry]);
  });

  it('finalizes a passed readback as written without storing full readback text', () => {
    const entry = buildFinalOmbreConfirmedWriteAuditEntry({
      id: 'audit-final-pass',
      now: 2,
      request: {
        content: 'Remember that confirmed readback passed.',
        tags: ['sullyos'],
        importance: 4,
        pinned: false,
        why_remembered: 'User approved.',
        meaning: 'Confirmed memory.',
      },
      mappingAudit: {
        source: { app: 'SullyOS', feature: 'chat', charId: 'char-xiaoguai', messageIds: [401] },
        dryRunRiskFlags: ['dry-run-not-written'],
        removedFields: ['test_data'],
      },
      writeResult: { ok: true, bucketId: '5202cd96db58', text: 'full write response', touchedMetadata: false },
      readbackResult: {
        ok: true,
        bucketId: '5202cd96db58',
        query: 'Remember that confirmed readback passed.',
        touchedMetadata: true,
        matchedBy: 'bucket-id',
        textHash: 'hash:v1:readback',
        textPreview: 'safe preview only',
      },
    });

    expect(entry.status).toBe('written');
    expect(entry.readbackStatus).toBe('passed');
    expect(entry.bucketId).toBe('5202cd96db58');
    expect(entry.dedupeTouchedMetadata).toBe(true);
    expect(JSON.stringify(entry)).not.toContain('full write response');
    expect(JSON.stringify(entry)).not.toContain('safe preview only');
  });

  it('finalizes a failed readback as write-succeeded-readback-failed', () => {
    const entry = buildFinalOmbreConfirmedWriteAuditEntry({
      id: 'audit-final-readback-failed',
      now: 3,
      request: {
        content: 'Remember that confirmed readback failed.',
        tags: ['sullyos'],
        importance: 4,
        pinned: false,
        why_remembered: 'User approved.',
        meaning: 'Confirmed memory.',
      },
      mappingAudit: {
        source: { app: 'SullyOS', feature: 'chat', messageIds: [402] },
        dryRunRiskFlags: [],
        removedFields: [],
      },
      writeResult: { ok: true, bucketId: '5202cd96db58', text: 'write response', touchedMetadata: false },
      readbackResult: {
        ok: false,
        bucketId: '5202cd96db58',
        query: 'Remember that confirmed readback failed.',
        touchedMetadata: true,
        matchedBy: 'none',
        textHash: 'hash:v1:miss',
        textPreview: 'different memory',
        reason: 'Readback match not found',
      },
    });

    expect(entry.status).toBe('write-succeeded-readback-failed');
    expect(entry.readbackStatus).toBe('failed');
    expect(entry.dedupeTouchedMetadata).toBe(true);
  });

  it('finalizes a write failure without readback', () => {
    const entry = buildFinalOmbreConfirmedWriteAuditEntry({
      id: 'audit-final-write-failed',
      now: 4,
      request: {
        content: 'Remember that confirmed write failed before readback.',
        tags: ['sullyos'],
        importance: 4,
        pinned: false,
        why_remembered: 'User approved.',
        meaning: 'Confirmed memory.',
      },
      mappingAudit: {
        source: { app: 'SullyOS', feature: 'chat', messageIds: [403] },
        dryRunRiskFlags: [],
        removedFields: [],
      },
      writeError: new Error('HTTP 500 with private body'),
    });

    expect(entry.status).toBe('write-failed');
    expect(entry.readbackStatus).toBe('not-run');
    expect(entry.dedupeTouchedMetadata).toBe(false);
    expect(JSON.stringify(entry)).not.toContain('HTTP 500');
  });

  it('final audit entries do not store full secret content or readback material', () => {
    const secretContent = 'password: correct horse battery staple and Bearer live-token-123456789';
    const fullReadback = 'full readback text with private details';
    const entry = buildFinalOmbreConfirmedWriteAuditEntry({
      request: {
        content: secretContent,
        tags: ['sullyos'],
        importance: 4,
        pinned: false,
        why_remembered: 'User approved.',
        meaning: 'Confirmed memory.',
      },
      mappingAudit: {
        source: { app: 'SullyOS', feature: 'chat', messageIds: [404] },
        dryRunRiskFlags: ['possible-secret-content'],
        removedFields: [],
      },
      writeResult: { ok: true, text: 'write response containing private details', touchedMetadata: false },
      readbackResult: {
        ok: false,
        query: 'password redacted query',
        touchedMetadata: true,
        matchedBy: 'none',
        textHash: 'hash:v1:secret',
        textPreview: fullReadback,
        reason: 'Readback match not found',
      },
    });

    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(secretContent);
    expect(serialized).not.toContain('correct horse battery staple');
    expect(serialized).not.toMatch(/Bearer\s+live-token/i);
    expect(serialized).not.toContain(fullReadback);
    expect(serialized).not.toContain('write response containing private details');
  });
});

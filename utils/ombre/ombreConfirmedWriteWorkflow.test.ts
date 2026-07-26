import { describe, expect, it, vi } from 'vitest';
import { runOmbreConfirmedHoldWorkflow } from './ombreConfirmedWriteWorkflow';
import {
  loadOmbreConfirmedWriteAuditEntries,
  OMBRE_CONFIRMED_WRITE_AUDIT_KEY,
} from './ombreConfirmedWriteAudit';
import type { OmbreConfirmedHoldRequest } from './ombreConfirmedWriteClient';
import type { OmbreConfirmedHoldMappingAudit } from './ombreConfirmedWriteMapper';
import type { OmbreProviderConfig } from './ombreTypes';

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

const request: OmbreConfirmedHoldRequest = {
  content: 'Remember that mocked confirmed workflow needs readback and audit.',
  tags: 'sullyos, feature:chat',
  importance: 4,
  pinned: false,
  why_remembered: 'User approved from SullyOS review UI.',
  meaning: 'Confirmed workflow candidate.',
};

const mappingAudit: OmbreConfirmedHoldMappingAudit = {
  source: { app: 'SullyOS', feature: 'chat', charId: 'char-xiaoguai', messageIds: [601] },
  dryRunRiskFlags: ['dry-run-not-written'],
  removedFields: ['test_data'],
  dedupeQuery: request.content,
};

function readbackConfig(endpoint: string): OmbreProviderConfig {
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

function workflowFetch(options: { writeOk: boolean; readbackText?: string }) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === 'tools/call' && body.params?.name === 'hold') {
      if (!options.writeOk) {
        return new Response('mock write failed', { status: 500, headers: { 'content-type': 'text/plain' } });
      }
      return new Response(JSON.stringify({
        result: { content: [{ type: 'text', text: 'created bucket 5202cd96db58' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body.method === 'initialize') {
      return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'workflow-session' },
      });
    }
    if (body.method === 'notifications/initialized') {
      return new Response('', { status: 202 });
    }
    return new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: options.readbackText ?? '' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
}

describe('runOmbreConfirmedHoldWorkflow', () => {
  it('runs a successful mocked write plus readback and appends audit', async () => {
    const storage = memoryStorage();
    const fetchImpl = workflowFetch({
      writeOk: true,
      readbackText: 'bucket 5202cd96db58 Remember that mocked confirmed workflow needs readback and audit.',
    });

    const result = await runOmbreConfirmedHoldWorkflow({
      endpoint: 'http://127.0.0.1:18001/mcp',
      readbackConfig: readbackConfig('http://workflow-success/mcp'),
      request,
      mappingAudit,
      fetchImpl,
      storage,
    });
    const entries = loadOmbreConfirmedWriteAuditEntries(storage);
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    const headers = fetchImpl.mock.calls.map(([, init]) => init.headers as Record<string, string>);

    expect(result.ok).toBe(true);
    expect(result.readbackStatus).toBe('passed');
    expect(result.auditId).toBe(entries[0].id);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('written');
    expect(entries[0].readbackStatus).toBe('passed');
    expect(entries[0].dedupeTouchedMetadata).toBe(true);
    expect(bodies[0].params.name).toBe('hold');
    expect(bodies[0].params.arguments).not.toHaveProperty('test_data');
    expect(bodies.some(body => body.method === 'tools/call' && body.params?.name === 'breath_search')).toBe(true);
    expect(headers.every(header => header.Authorization === undefined)).toBe(true);
    expect(JSON.stringify(headers)).not.toMatch(/Bearer/i);
  });

  it('appends write-failed audit and does not run readback when the mocked write fails', async () => {
    const storage = memoryStorage();
    const fetchImpl = workflowFetch({ writeOk: false });

    const result = await runOmbreConfirmedHoldWorkflow({
      endpoint: 'http://127.0.0.1:18001/mcp',
      readbackConfig: readbackConfig('http://workflow-write-failed/mcp'),
      request,
      mappingAudit,
      fetchImpl,
      storage,
    });
    const entries = loadOmbreConfirmedWriteAuditEntries(storage);
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)));

    expect(result.ok).toBe(false);
    expect(result.readbackStatus).toBe('not-run');
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('write-failed');
    expect(entries[0].readbackStatus).toBe('not-run');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].params.name).toBe('hold');
    expect(JSON.stringify(entries[0])).not.toContain('mock write failed');
  });

  it('appends write-succeeded-readback-failed audit when readback cannot match', async () => {
    const storage = memoryStorage();
    const fetchImpl = workflowFetch({ writeOk: true, readbackText: 'different memory only' });

    const result = await runOmbreConfirmedHoldWorkflow({
      endpoint: 'http://127.0.0.1:18001/mcp',
      readbackConfig: readbackConfig('http://workflow-readback-failed/mcp'),
      request,
      mappingAudit,
      fetchImpl,
      storage,
    });
    const entries = loadOmbreConfirmedWriteAuditEntries(storage);

    expect(result.ok).toBe(false);
    expect(result.readbackStatus).toBe('failed');
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('write-succeeded-readback-failed');
    expect(entries[0].readbackStatus).toBe('failed');
    expect(storage.getItem(OMBRE_CONFIRMED_WRITE_AUDIT_KEY)).not.toContain('different memory only');
  });
});

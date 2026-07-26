import { describe, expect, it, vi } from 'vitest';
import { verifyOmbreConfirmedHoldReadback } from './ombreConfirmedReadback';
import type { OmbreConfirmedHoldRequest, OmbreConfirmedWriteResult } from './ombreConfirmedWriteClient';
import type { OmbreProviderConfig } from './ombreTypes';

function config(endpoint: string, strictNoTouch = false): OmbreProviderConfig {
  return {
    enabled: true,
    corePrompt: 'core',
    mcpEndpoint: endpoint,
    memoryRecallMode: 'search',
    memoryWriteMode: 'off',
    maxResults: 3,
    maxMemoryChars: 1200,
    strictNoTouch,
  };
}

const request: OmbreConfirmedHoldRequest = {
  content: 'Remember that confirmed memories need readback proof before they are trusted.',
  tags: 'sullyos, feature:chat',
  importance: 4,
  pinned: false,
  why_remembered: 'Confirmed by the user from SullyOS chat.',
  meaning: 'Confirmed memory candidate.',
};

function writeResult(bucketId?: string): OmbreConfirmedWriteResult {
  return {
    ok: true,
    bucketId,
    text: bucketId ? `new bucket ${bucketId}` : 'new bucket without id',
    touchedMetadata: false,
  };
}

function readbackFetch(readbackText: string) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.method === 'initialize') {
      return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'readback-session' },
      });
    }
    if (body.method === 'notifications/initialized') {
      return new Response('', { status: 202 });
    }
    return new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: readbackText }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
}

function toolCall(fetchImpl: any) {
  const call = fetchImpl.mock.calls.find(([, init]: [string, RequestInit]) => (
    JSON.parse(String(init.body)).method === 'tools/call'
  ));
  if (!call) throw new Error('Expected tools/call request');
  return call;
}

describe('verifyOmbreConfirmedHoldReadback', () => {
  it('passes by bucket id and records breath_search metadata touch', async () => {
    const fetchImpl = readbackFetch('stored memory bucket=5202cd96db58 content is readable');

    const result = await verifyOmbreConfirmedHoldReadback(
      config('http://readback-bucket/mcp'),
      request,
      writeResult('5202cd96db58'),
      fetchImpl,
    );
    const [, init] = toolCall(fetchImpl);
    const body = JSON.parse(String(init.body));

    expect(result.ok).toBe(true);
    expect(result.matchedBy).toBe('bucket-id');
    expect(result.bucketId).toBe('5202cd96db58');
    expect(result.touchedMetadata).toBe(true);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('breath_search');
    expect(body.params.arguments).toMatchObject({ max_results: 3 });
    expect(body.params.arguments.query).toContain('Remember that confirmed memories');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toMatch(/Bearer/i);
  });

  it('passes by content when the write result has no bucket id', async () => {
    const fetchImpl = readbackFetch('Remember that confirmed memories need readback proof before they are trusted.');

    const result = await verifyOmbreConfirmedHoldReadback(
      config('http://readback-content/mcp'),
      request,
      writeResult(),
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(result.matchedBy).toBe('content');
    expect(result.touchedMetadata).toBe(true);
  });

  it('fails when neither bucket id nor meaningful content appears in readback', async () => {
    const fetchImpl = readbackFetch('different memory result');

    const result = await verifyOmbreConfirmedHoldReadback(
      config('http://readback-miss/mcp'),
      request,
      writeResult('5202cd96db58'),
      fetchImpl,
    );

    expect(result.ok).toBe(false);
    expect(result.matchedBy).toBe('none');
    expect(result.reason).toMatch(/not found/i);
  });

  it('fails safe with strictNoTouch=true and does not retry or fetch', async () => {
    const fetchImpl = vi.fn() as any;

    const result = await verifyOmbreConfirmedHoldReadback(
      config('http://readback-strict/mcp', true),
      request,
      writeResult('5202cd96db58'),
      fetchImpl,
    );

    expect(result.ok).toBe(false);
    expect(result.matchedBy).toBe('none');
    expect(result.reason).toMatch(/strictNoTouch/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns only hash and redacted capped preview, not the full readback text', async () => {
    const fullReadback = [
      'Remember that confirmed memories need readback proof before they are trusted.',
      'Bearer live-token-123456789 should never be stored in full.',
      'Extra private readback text '.repeat(20),
    ].join(' ');
    const fetchImpl = readbackFetch(fullReadback);

    const result = await verifyOmbreConfirmedHoldReadback(
      config('http://readback-preview/mcp'),
      request,
      writeResult(),
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(result.textHash).toMatch(/^hash:v1:/);
    expect(result.textPreview.length).toBeLessThanOrEqual(120);
    expect(result.textPreview).not.toMatch(/Bearer\s+live-token/i);
    expect(JSON.stringify(result)).not.toContain(fullReadback);
  });
});

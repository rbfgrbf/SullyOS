import { describe, expect, it, vi } from 'vitest';
import { assertSafeConfirmedWriteEndpoint, callOmbreConfirmedHold } from './ombreConfirmedWriteClient';

const safeRequest = {
  content: 'Remember that user-approved SullyOS memories must stay visible and auditable.',
  tags: 'sullyos, feature:chat, confirmed',
  importance: 4,
  pinned: false,
  why_remembered: 'Confirmed by user from SullyOS memory review.',
  meaning: 'User-approved memory from SullyOS chat.',
} as const;

function bodyForFirstCall(fetchImpl: any) {
  const [, init] = fetchImpl.mock.calls[0];
  return JSON.parse(String(init.body));
}

describe('Ombre confirmed write client', () => {
  it('rejects non-loopback endpoints before fetch', async () => {
    const fetchImpl = vi.fn() as any;

    expect(() => assertSafeConfirmedWriteEndpoint('https://memory.782bet.cc/mcp')).toThrow(/loopback/i);
    await expect(callOmbreConfirmedHold('https://memory.782bet.cc/mcp', safeRequest, fetchImpl)).rejects.toThrow(/loopback/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects test_data before fetch because formal confirmed writes are not test bucket writes', async () => {
    const fetchImpl = vi.fn() as any;

    await expect(callOmbreConfirmedHold(
      'http://127.0.0.1:18001/mcp',
      { ...safeRequest, test_data: true } as any,
      fetchImpl,
    )).rejects.toThrow(/test_data/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects pinned writes and empty content before fetch', async () => {
    const fetchImpl = vi.fn() as any;

    await expect(callOmbreConfirmedHold(
      'http://localhost:18001/mcp',
      { ...safeRequest, pinned: true } as any,
      fetchImpl,
    )).rejects.toThrow(/pinned/i);
    await expect(callOmbreConfirmedHold(
      'http://localhost:18001/mcp',
      { ...safeRequest, content: '   ' },
      fetchImpl,
    )).rejects.toThrow(/content/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'Bearer live-token-123456789',
    'api_key = sk-test-123456789012',
    'password: correct horse battery staple',
    'verification code 123456',
    'recovery code alpha-bravo-charlie',
    '\u5bc6\u7801\uff1aabc123456',
    '\u9a8c\u8bc1\u7801\u662f123456',
    '\u6062\u590d\u7801 alpha-bravo-charlie',
  ])('rejects suspected secret content before fetch: %s', async content => {
    const fetchImpl = vi.fn() as any;

    await expect(callOmbreConfirmedHold(
      'http://127.0.0.1:18001/mcp',
      { ...safeRequest, content },
      fetchImpl,
    )).rejects.toThrow(/secret/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts one mock JSON-RPC tools/call hold request without auth headers or test_data', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: '新建→5202cd96db58 未分类' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

    const result = await callOmbreConfirmedHold('http://127.0.0.1:18001/mcp', safeRequest, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    const body = bodyForFirstCall(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:18001/mcp');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toMatch(/Bearer/i);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('hold');
    expect(body.params.arguments).toEqual(safeRequest);
    expect(body.params.arguments).not.toHaveProperty('test_data');
    expect(result).toEqual({
      ok: true,
      bucketId: '5202cd96db58',
      text: '新建→5202cd96db58 未分类',
      touchedMetadata: false,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { callOmbreReadTool, listOmbreTools, parseOmbreMcpResponse } from './ombreMcpClient';

const config: any = {
  enabled: true,
  corePrompt: 'core',
  mcpEndpoint: 'http://127.0.0.1:18001/mcp',
  memoryRecallMode: 'search',
  memoryWriteMode: 'off',
  maxResults: 3,
  maxMemoryChars: 1200,
  strictNoTouch: false,
};

function fetchCallForMethod(fetchImpl: any, method: string) {
  const call = fetchImpl.mock.calls.find(([, init]: [string, RequestInit]) => (
    JSON.parse(String(init.body)).method === method
  ));
  if (!call) throw new Error(`No fetch call for MCP method: ${method}`);
  return call;
}

describe('Ombre MCP client', () => {
  it('parses JSON and SSE MCP responses', () => {
    expect(parseOmbreMcpResponse('{"result":{"tools":[]}}', 'application/json')).toEqual({ result: { tools: [] } });
    expect(parseOmbreMcpResponse('event: message\ndata: {"result":{"ok":true}}\n\n', 'text/event-stream')).toEqual({ result: { ok: true } });
  });

  it('initializes a streamable HTTP MCP session before listing tools', async () => {
    const calls: Array<{ method: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = JSON.parse(String(init.body));
      calls.push({ method: body.method, headers });

      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-live' },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }

      if (body.method === 'tools/list' && headers['Mcp-Session-Id'] === 'session-live') {
        return new Response(JSON.stringify({ result: { tools: [{ name: 'breath_search' }] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: { message: 'Missing session' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    const tools = await listOmbreTools({ ...config, mcpEndpoint: 'http://needs-init/mcp' }, fetchImpl);

    expect(tools).toEqual([{ name: 'breath_search' }]);
    expect(calls.map(call => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(calls[1].headers['Mcp-Session-Id']).toBe('session-live');
    expect(calls[2].headers['Mcp-Session-Id']).toBe('session-live');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('blocks write tools in the read client', async () => {
    const fetchImpl = vi.fn() as any;

    await expect(callOmbreReadTool(config, 'hold', { content: 'write' }, fetchImpl)).rejects.toThrow(/write tool/i);
    await expect(callOmbreReadTool(config, 'I', { content: 'new self fact' }, fetchImpl)).rejects.toThrow(/write tool/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks unknown tools in the read client', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: 'should not be called' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;

    await expect(callOmbreReadTool(config, 'memory_admin', {}, fetchImpl)).rejects.toThrow(/read tool/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks metadata-touching read tools when strictNoTouch is enabled', async () => {
    const fetchImpl = vi.fn() as any;

    await expect(callOmbreReadTool(
      { ...config, strictNoTouch: true },
      'breath_search',
      { query: 'promise', max_results: 3 },
      fetchImpl,
    )).rejects.toThrow(/strictNoTouch/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calls breath_search with JSON-RPC tools/call without auth headers', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-search' },
        });
      }
      return new Response(JSON.stringify({
        result: { content: [{ type: 'text', text: 'memory text' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    const result = await callOmbreReadTool(
      { ...config, mcpEndpoint: 'http://breath-search/mcp' },
      'breath_search',
      { query: 'promise', max_results: 3 },
      fetchImpl,
    );
    const [, init] = fetchCallForMethod(fetchImpl, 'tools/call');
    const body = JSON.parse(init.body);

    expect(result.text).toBe('memory text');
    expect(result.touchesMetadata).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://breath-search/mcp');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).method).toBe('initialize');
    expect(body.method).toBe('tools/call');
    expect(body.params).toEqual({ name: 'breath_search', arguments: { query: 'promise', max_results: 3 } });
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['Mcp-Session-Id']).toBe('session-search');
  });

  it('allows I read mode through the read client', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-self' },
        });
      }
      return new Response(JSON.stringify({
        result: { content: [{ type: 'text', text: 'self read text' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    const result = await callOmbreReadTool({ ...config, mcpEndpoint: 'http://self-read/mcp' }, 'I', { read: true }, fetchImpl);
    const [, init] = fetchCallForMethod(fetchImpl, 'tools/call');
    const body = JSON.parse(init.body);

    expect(result.text).toBe('self read text');
    expect(result.touchesMetadata).toBe(false);
    expect(body.method).toBe('tools/call');
    expect(body.params).toEqual({ name: 'I', arguments: { read: true } });
    expect(init.headers['Mcp-Session-Id']).toBe('session-self');
  });

  it('lists tools with JSON-RPC tools/list', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-list' },
        });
      }
      return new Response(JSON.stringify({
        result: { tools: [{ name: 'breath_search' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    const tools = await listOmbreTools({ ...config, mcpEndpoint: 'http://list-tools/mcp' }, fetchImpl);
    const [, init] = fetchCallForMethod(fetchImpl, 'tools/list');

    expect(tools).toEqual([{ name: 'breath_search' }]);
    expect(JSON.parse(init.body).method).toBe('tools/list');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['Mcp-Session-Id']).toBe('session-list');
  });

  it('reinitializes once when a stored MCP session is rejected', async () => {
    let initializeCount = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const headers = init.headers as Record<string, string>;

      if (body.method === 'initialize') {
        initializeCount += 1;
        const session = initializeCount === 1 ? 'expired-session' : 'fresh-session';
        return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': session },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }

      if (body.method === 'tools/list' && headers['Mcp-Session-Id'] === 'expired-session') {
        return new Response(JSON.stringify({ error: { message: 'Missing session' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ result: { tools: [{ name: 'breath' }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    const tools = await listOmbreTools({ ...config, mcpEndpoint: 'http://expired-session/mcp' }, fetchImpl);

    expect(tools).toEqual([{ name: 'breath' }]);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)).method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    const toolListSessions = fetchImpl.mock.calls
      .filter(([, init]) => JSON.parse(String(init.body)).method === 'tools/list')
      .map(([, init]) => (init.headers as Record<string, string>)['Mcp-Session-Id']);
    expect(toolListSessions).toEqual(['expired-session', 'fresh-session']);
  });

  it('reinitializes once when a stored MCP session returns 404 not found', async () => {
    let initializeCount = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const headers = init.headers as Record<string, string>;

      if (body.method === 'initialize') {
        initializeCount += 1;
        const session = initializeCount === 1 ? 'not-found-session' : 'fresh-session-404';
        return new Response(JSON.stringify({ result: { protocolVersion: '2024-11-05' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': session },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }

      if (body.method === 'tools/list' && headers['Mcp-Session-Id'] === 'not-found-session') {
        return new Response(JSON.stringify({ error: { message: 'Session not found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ result: { tools: [{ name: 'breath' }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    const tools = await listOmbreTools({ ...config, mcpEndpoint: 'http://not-found-session/mcp' }, fetchImpl);

    expect(tools).toEqual([{ name: 'breath' }]);
    const toolListSessions = fetchImpl.mock.calls
      .filter(([, init]) => JSON.parse(String(init.body)).method === 'tools/list')
      .map(([, init]) => (init.headers as Record<string, string>)['Mcp-Session-Id']);
    expect(toolListSessions).toEqual(['not-found-session', 'fresh-session-404']);
  });

  it('does not share MCP session IDs across endpoints', async () => {
    const configA = { ...config, mcpEndpoint: 'http://endpoint-a/mcp' };
    const configB = { ...config, mcpEndpoint: 'http://endpoint-b/mcp' };
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify({
      result: { tools: [{ name: url }] },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...(url === 'http://endpoint-a/mcp' ? { 'mcp-session-id': 'session-a' } : {}),
      },
    })) as any;

    await listOmbreTools(configA, fetchImpl);
    await listOmbreTools(configB, fetchImpl);
    await listOmbreTools(configA, fetchImpl);

    const calls = fetchImpl.mock.calls.map(([url, init]) => ({
      url,
      method: JSON.parse(init.body).method,
      session: init.headers['Mcp-Session-Id'],
    }));

    expect(calls).toEqual([
      { url: 'http://endpoint-a/mcp', method: 'initialize', session: undefined },
      { url: 'http://endpoint-a/mcp', method: 'notifications/initialized', session: 'session-a' },
      { url: 'http://endpoint-a/mcp', method: 'tools/list', session: 'session-a' },
      { url: 'http://endpoint-b/mcp', method: 'initialize', session: undefined },
      { url: 'http://endpoint-b/mcp', method: 'notifications/initialized', session: undefined },
      { url: 'http://endpoint-b/mcp', method: 'tools/list', session: undefined },
      { url: 'http://endpoint-a/mcp', method: 'tools/list', session: 'session-a' },
    ]);
  });
});

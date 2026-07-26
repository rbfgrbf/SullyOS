import type { OmbreProviderConfig, OmbreToolName } from './ombreTypes';
import { isOmbreReadTool, isOmbreWriteTool, toolTouchesMetadata } from './ombreTypes';

type McpResponse = { result?: any; error?: { code?: number; message?: string } };

let requestId = 0;
const sessionIdsByEndpoint = new Map<string, string>();
const initializedEndpoints = new Set<string>();
const initializingByEndpoint = new Map<string, Promise<void>>();

export function parseOmbreMcpResponse(text: string, contentType: string): McpResponse {
  if (contentType.includes('text/event-stream') || /^\s*(event:|data:)/.test(text)) {
    const data = text.split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.replace(/^data:\s?/, '').trim())
      .filter(Boolean);

    for (let i = data.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(data[i]);
      } catch {
        // Try the previous event chunk.
      }
    }
  }

  return JSON.parse(text);
}

function endpointOf(config: OmbreProviderConfig): string {
  const endpoint = config.proxyEndpoint || config.mcpEndpoint;
  if (!endpoint) throw new Error('Ombre MCP endpoint is not configured');
  return endpoint;
}

function mcpRequest(method: string, params?: any, notification = false): any {
  const req: any = { jsonrpc: '2.0', method, params };
  if (!notification) req.id = ++requestId;
  return req;
}

async function postMcp(
  config: OmbreProviderConfig,
  body: any,
  fetchImpl: typeof fetch = fetch,
  options: { skipInitialize?: boolean; retriedAfterSessionReset?: boolean } = {},
): Promise<McpResponse> {
  const endpoint = endpointOf(config);
  if (!options.skipInitialize && body?.method !== 'initialize') {
    await ensureMcpInitialized(config, fetchImpl);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  const sessionId = sessionIdsByEndpoint.get(endpoint);
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok) {
    if (
      !options.skipInitialize
      && !options.retriedAfterSessionReset
      && body?.method !== 'initialize'
      && (response.status === 400 || response.status === 401 || response.status === 404)
      && /session/i.test(text)
    ) {
      sessionIdsByEndpoint.delete(endpoint);
      initializedEndpoints.delete(endpoint);
      await ensureMcpInitialized(config, fetchImpl);
      return postMcp(config, body, fetchImpl, { retriedAfterSessionReset: true });
    }
    throw new Error(`Ombre MCP HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const nextSession = response.headers.get('Mcp-Session-Id') || response.headers.get('mcp-session-id');
  if (nextSession) sessionIdsByEndpoint.set(endpoint, nextSession);

  const contentType = response.headers.get('content-type') || '';
  if (!text.trim()) return {};
  const parsed = parseOmbreMcpResponse(text, contentType);
  if (
    parsed.error
    && !options.skipInitialize
    && !options.retriedAfterSessionReset
    && body?.method !== 'initialize'
    && /session/i.test(parsed.error.message || '')
  ) {
    sessionIdsByEndpoint.delete(endpoint);
    initializedEndpoints.delete(endpoint);
    await ensureMcpInitialized(config, fetchImpl);
    return postMcp(config, body, fetchImpl, { retriedAfterSessionReset: true });
  }
  if (parsed.error) throw new Error(`Ombre MCP error: ${parsed.error.message || parsed.error.code}`);
  return parsed;
}

async function ensureMcpInitialized(
  config: OmbreProviderConfig,
  fetchImpl: typeof fetch,
): Promise<void> {
  const endpoint = endpointOf(config);
  if (initializedEndpoints.has(endpoint)) return;
  const inFlight = initializingByEndpoint.get(endpoint);
  if (inFlight) return inFlight;

  const initPromise = (async () => {
    await postMcp(config, mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'sullyos-ombre-provider',
        version: '0.1.0',
      },
    }), fetchImpl, { skipInitialize: true });
    await postMcp(config, mcpRequest('notifications/initialized', undefined, true), fetchImpl, { skipInitialize: true });
    initializedEndpoints.add(endpoint);
  })();
  initializingByEndpoint.set(endpoint, initPromise);
  try {
    await initPromise;
  } finally {
    initializingByEndpoint.delete(endpoint);
  }
}

export async function listOmbreTools(
  config: OmbreProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<any[]> {
  const response = await postMcp(config, mcpRequest('tools/list'), fetchImpl);
  return Array.isArray(response.result?.tools) ? response.result.tools : [];
}

export async function callOmbreReadTool(
  config: OmbreProviderConfig,
  name: OmbreToolName,
  args: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; touchesMetadata: boolean }> {
  if (isOmbreWriteTool(name, args)) {
    throw new Error(`Refusing to call Ombre write tool in read client: ${name}`);
  }
  if (!isOmbreReadTool(name, args)) {
    throw new Error(`Refusing to call Ombre tool that is not an allowlisted read tool in read client: ${name}`);
  }
  if (config.strictNoTouch && toolTouchesMetadata(name, args)) {
    throw new Error(`Refusing to call Ombre read tool that touches metadata while strictNoTouch is enabled: ${name}`);
  }

  const response = await postMcp(config, mcpRequest('tools/call', { name, arguments: args }), fetchImpl);
  const content = response.result?.content;
  const text = Array.isArray(content)
    ? content.map((item: any) => typeof item?.text === 'string' ? item.text : '').filter(Boolean).join('\n')
    : typeof response.result?.result === 'string' ? response.result.result
      : typeof response.result === 'string' ? response.result
        : JSON.stringify(response.result ?? '');

  return { text, touchesMetadata: toolTouchesMetadata(name, args) };
}

export interface OmbreConfirmedHoldRequest {
  content: string;
  tags: string;
  importance: number;
  pinned: false;
  why_remembered: string;
  meaning: string;
}

export interface OmbreConfirmedWriteResult {
  ok: boolean;
  bucketId?: string;
  text: string;
  touchedMetadata: boolean;
}

type McpResponse = { result?: any; error?: { code?: number; message?: string } };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
let requestId = 0;
const sessionIdsByEndpoint = new Map<string, string>();
const initializedEndpoints = new Set<string>();
const initializingByEndpoint = new Map<string, Promise<void>>();
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(api[_ -]?key|apikey|secret[_ -]?key)\b\s*[:=]/i,
  /\b(password|passwd|pwd)\b\s*[:=]/i,
  /\b(verification|auth|login)\s+code\b/i,
  /\brecovery\s+code\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\u5bc6\u7801\s*[:\uff1a\u662f=]/,
  /\u9a8c\u8bc1\u7801\s*[:\uff1a\u662f=]?\s*\d{4,}/,
  /\u6062\u590d\u7801\s*[:\uff1a\u662f=]?/,
];

export function assertSafeConfirmedWriteEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Confirmed Ombre write endpoint must be a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Confirmed Ombre write endpoint must use http or https');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Confirmed Ombre writes are limited to loopback endpoints');
  }
  if (url.username || url.password) {
    throw new Error('Confirmed Ombre write endpoint must not include credentials');
  }
}

function textFields(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(item => textFields(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [key, ...textFields(item)]);
  }
  return [];
}

function containsPossibleSecret(value: unknown): boolean {
  const combined = textFields(value).join('\n');
  return SECRET_PATTERNS.some(pattern => pattern.test(combined));
}

function assertSafeHoldRequest(request: OmbreConfirmedHoldRequest): void {
  const raw = request as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, 'test_data')) {
    throw new Error('Confirmed Ombre hold requests must not include test_data');
  }
  if (request.pinned !== false) {
    throw new Error('Confirmed Ombre hold requests must use pinned=false');
  }
  if (typeof request.content !== 'string' || request.content.trim().length === 0) {
    throw new Error('Confirmed Ombre hold requests require non-empty content');
  }
  if (typeof request.tags !== 'string') {
    throw new Error('Confirmed Ombre hold request tags must be a string');
  }
  if (containsPossibleSecret(request)) {
    throw new Error('Confirmed Ombre hold request contains possible secret content');
  }
}

function mcpRequest(method: string, params?: Record<string, unknown>, notification = false): Record<string, unknown> {
  const body: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (!notification) body.id = ++requestId;
  return body;
}

function holdToolRequest(request: OmbreConfirmedHoldRequest): Record<string, unknown> {
  return {
    ...mcpRequest('tools/call', {
      name: 'hold',
      arguments: {
        content: request.content,
        tags: request.tags,
        importance: request.importance,
        pinned: request.pinned,
        why_remembered: request.why_remembered,
        meaning: request.meaning,
      },
    }),
  };
}

async function postMcp(
  endpoint: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  options: { skipInitialize?: boolean; retriedAfterSessionReset?: boolean } = {},
): Promise<McpResponse> {
  if (!options.skipInitialize && body.method !== 'initialize') {
    await ensureMcpInitialized(endpoint, fetchImpl);
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
      && body.method !== 'initialize'
      && (response.status === 400 || response.status === 401 || response.status === 404)
      && /session/i.test(text)
    ) {
      sessionIdsByEndpoint.delete(endpoint);
      initializedEndpoints.delete(endpoint);
      await ensureMcpInitialized(endpoint, fetchImpl);
      return postMcp(endpoint, body, fetchImpl, { retriedAfterSessionReset: true });
    }
    throw new Error(`Ombre confirmed hold HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const nextSession = response.headers.get('Mcp-Session-Id') || response.headers.get('mcp-session-id');
  if (nextSession) sessionIdsByEndpoint.set(endpoint, nextSession);

  const contentType = response.headers.get('content-type') || '';
  const parsed = text.trim() ? parseMcpResponse(text, contentType) : {};
  if (
    parsed.error
    && !options.skipInitialize
    && !options.retriedAfterSessionReset
    && body.method !== 'initialize'
    && /session/i.test(parsed.error.message || '')
  ) {
    sessionIdsByEndpoint.delete(endpoint);
    initializedEndpoints.delete(endpoint);
    await ensureMcpInitialized(endpoint, fetchImpl);
    return postMcp(endpoint, body, fetchImpl, { retriedAfterSessionReset: true });
  }
  if (parsed.error) {
    throw new Error(`Ombre confirmed hold error: ${parsed.error.message || parsed.error.code}`);
  }
  return parsed;
}

async function ensureMcpInitialized(endpoint: string, fetchImpl: typeof fetch): Promise<void> {
  if (initializedEndpoints.has(endpoint)) return;
  const inFlight = initializingByEndpoint.get(endpoint);
  if (inFlight) return inFlight;

  const initPromise = (async () => {
    await postMcp(endpoint, mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'sullyos-ombre-confirmed-writer',
        version: '0.1.0',
      },
    }), fetchImpl, { skipInitialize: true });
    await postMcp(endpoint, mcpRequest('notifications/initialized', undefined, true), fetchImpl, { skipInitialize: true });
    initializedEndpoints.add(endpoint);
  })();

  initializingByEndpoint.set(endpoint, initPromise);
  try {
    await initPromise;
  } finally {
    initializingByEndpoint.delete(endpoint);
  }
}

function parseMcpResponse(text: string, contentType: string): McpResponse {
  if (contentType.includes('text/event-stream') || /^\s*(event:|data:)/.test(text)) {
    const chunks = text.split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.replace(/^data:\s?/, '').trim())
      .filter(Boolean);

    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(chunks[i]);
      } catch {
        // Try the previous SSE chunk.
      }
    }
  }
  return JSON.parse(text);
}

function textFromMcpResponse(response: McpResponse): string {
  const content = response.result?.content;
  if (Array.isArray(content)) {
    return content
      .map((item: any) => typeof item?.text === 'string' ? item.text : '')
      .filter(Boolean)
      .join('\n');
  }
  if (typeof response.result?.result === 'string') return response.result.result;
  if (typeof response.result === 'string') return response.result;
  return JSON.stringify(response.result ?? '');
}

function bucketIdFromText(text: string): string | undefined {
  return text.match(/\b[0-9a-f]{12}\b/i)?.[0];
}

export async function callOmbreConfirmedHold(
  endpoint: string,
  request: OmbreConfirmedHoldRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<OmbreConfirmedWriteResult> {
  assertSafeConfirmedWriteEndpoint(endpoint);
  assertSafeHoldRequest(request);

  const parsed = await postMcp(endpoint, holdToolRequest(request), fetchImpl);
  const resultText = textFromMcpResponse(parsed);
  return {
    ok: true,
    bucketId: bucketIdFromText(resultText),
    text: resultText,
    touchedMetadata: false,
  };
}

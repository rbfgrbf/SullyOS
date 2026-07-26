import { callOmbreReadTool } from './ombreMcpClient';
import type { OmbreProviderConfig } from './ombreTypes';
import type { OmbreConfirmedHoldRequest, OmbreConfirmedWriteResult } from './ombreConfirmedWriteClient';

export interface OmbreConfirmedReadbackResult {
  ok: boolean;
  bucketId?: string;
  query: string;
  touchedMetadata: boolean;
  matchedBy: 'bucket-id' | 'content' | 'none';
  textHash: string;
  textPreview: string;
  reason?: string;
}

const QUERY_MAX_CHARS = 96;
const PREVIEW_MAX_CHARS = 120;
const CONTENT_MATCH_MAX_CHARS = 72;
const MIN_CONTENT_MATCH_CHARS = 12;

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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function redactSecrets(text: string): string {
  return SECRET_REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

function capChars(text: string, maxChars: number): string {
  return [...text].slice(0, maxChars).join('');
}

function stableHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `hash:v1:${hash.toString(16).padStart(8, '0')}`;
}

function safePreview(text: string): string {
  return capChars(normalizeText(redactSecrets(text)), PREVIEW_MAX_CHARS);
}

function readbackQuery(content: string): string {
  return capChars(normalizeText(redactSecrets(content)), QUERY_MAX_CHARS);
}

function meaningfulContentFragment(content: string): string | undefined {
  const normalized = normalizeText(redactSecrets(content));
  if ([...normalized].length < MIN_CONTENT_MATCH_CHARS) return undefined;
  return capChars(normalized, CONTENT_MATCH_MAX_CHARS);
}

function includesText(haystack: string, needle: string): boolean {
  return normalizeText(haystack).toLocaleLowerCase().includes(normalizeText(needle).toLocaleLowerCase());
}

function failedResult(
  query: string,
  bucketId: string | undefined,
  reason: string,
  text = '',
  touchedMetadata = false,
): OmbreConfirmedReadbackResult {
  return {
    ok: false,
    bucketId,
    query,
    touchedMetadata,
    matchedBy: 'none',
    textHash: stableHash(text),
    textPreview: safePreview(text),
    reason,
  };
}

export async function verifyOmbreConfirmedHoldReadback(
  config: OmbreProviderConfig,
  request: OmbreConfirmedHoldRequest,
  writeResult: OmbreConfirmedWriteResult,
  fetchImpl?: typeof fetch,
): Promise<OmbreConfirmedReadbackResult> {
  const query = readbackQuery(request.content);
  const bucketId = writeResult.bucketId;

  try {
    const readback = await callOmbreReadTool(
      config,
      'breath_search',
      { query, max_results: 3 },
      fetchImpl,
    );
    const textHash = stableHash(readback.text);
    const textPreview = safePreview(readback.text);

    if (bucketId && includesText(readback.text, bucketId)) {
      return {
        ok: true,
        bucketId,
        query,
        touchedMetadata: readback.touchesMetadata,
        matchedBy: 'bucket-id',
        textHash,
        textPreview,
      };
    }

    const fragment = meaningfulContentFragment(request.content);
    if (fragment && includesText(readback.text, fragment)) {
      return {
        ok: true,
        bucketId,
        query,
        touchedMetadata: readback.touchesMetadata,
        matchedBy: 'content',
        textHash,
        textPreview,
      };
    }

    return failedResult(
      query,
      bucketId,
      'Readback match not found by bucket id or content fragment',
      readback.text,
      readback.touchesMetadata,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Readback failed';
    return failedResult(query, bucketId, reason);
  }
}

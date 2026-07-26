import {
  appendOmbreConfirmedWriteAuditEntry,
  buildFinalOmbreConfirmedWriteAuditEntry,
} from './ombreConfirmedWriteAudit';
import { callOmbreConfirmedHold } from './ombreConfirmedWriteClient';
import { verifyOmbreConfirmedHoldReadback } from './ombreConfirmedReadback';
import type { OmbreProviderConfig } from './ombreTypes';
import type { OmbreConfirmedHoldRequest, OmbreConfirmedWriteResult } from './ombreConfirmedWriteClient';
import type { OmbreConfirmedHoldMappingAudit } from './ombreConfirmedWriteMapper';

export interface RunOmbreConfirmedHoldWorkflowInput {
  endpoint: string;
  readbackConfig: OmbreProviderConfig;
  request: OmbreConfirmedHoldRequest;
  mappingAudit: OmbreConfirmedHoldMappingAudit;
  fetchImpl?: typeof fetch;
  storage?: Storage;
}

export interface RunOmbreConfirmedHoldWorkflowResult {
  ok: boolean;
  writeResult?: OmbreConfirmedWriteResult;
  readbackStatus: 'not-run' | 'passed' | 'failed';
  auditId?: string;
  error?: string;
}

const SECRET_REDACTIONS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted-secret]'],
  [/\b(api[_ -]?key|apikey|secret[_ -]?key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted-secret]'],
  [/\b(password|passwd|pwd)\b\s*[:=]\s*[^\s,;]+(?:\s+[^\s,;]+){0,5}/gi, '$1=[redacted-secret]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/gi, 'sk-[redacted-secret]'],
];

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Confirmed Ombre workflow failed';
  return SECRET_REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    raw,
  ).slice(0, 200);
}

function endpointKind(endpoint: string): 'loopback-mcp' | 'loopback-proxy' {
  try {
    return new URL(endpoint).pathname.toLocaleLowerCase().includes('proxy')
      ? 'loopback-proxy'
      : 'loopback-mcp';
  } catch {
    return 'loopback-mcp';
  }
}

export async function runOmbreConfirmedHoldWorkflow(
  input: RunOmbreConfirmedHoldWorkflowInput,
): Promise<RunOmbreConfirmedHoldWorkflowResult> {
  let writeResult: OmbreConfirmedWriteResult;

  try {
    writeResult = await callOmbreConfirmedHold(input.endpoint, input.request, input.fetchImpl);
  } catch (error) {
    const auditEntry = buildFinalOmbreConfirmedWriteAuditEntry({
      request: input.request,
      mappingAudit: input.mappingAudit,
      writeError: error,
      endpointKind: endpointKind(input.endpoint),
    });
    appendOmbreConfirmedWriteAuditEntry(auditEntry, input.storage);
    return {
      ok: false,
      readbackStatus: 'not-run',
      auditId: auditEntry.id,
      error: safeError(error),
    };
  }

  const readbackResult = await verifyOmbreConfirmedHoldReadback(
    input.readbackConfig,
    input.request,
    writeResult,
    input.fetchImpl,
  );
  const auditEntry = buildFinalOmbreConfirmedWriteAuditEntry({
    request: input.request,
    mappingAudit: input.mappingAudit,
    writeResult,
    readbackResult,
    endpointKind: endpointKind(input.endpoint),
  });
  appendOmbreConfirmedWriteAuditEntry(auditEntry, input.storage);

  const readbackStatus = readbackResult.ok ? 'passed' : 'failed';
  return {
    ok: readbackResult.ok,
    writeResult,
    readbackStatus,
    auditId: auditEntry.id,
    ...(readbackResult.ok ? {} : { error: readbackResult.reason ?? 'Confirmed Ombre readback failed' }),
  };
}

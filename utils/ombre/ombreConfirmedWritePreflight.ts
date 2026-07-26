import {
  buildOmbreConfirmedWriteAuditEntry,
} from './ombreConfirmedWriteAudit';
import type { OmbreConfirmedWriteQueueItem } from './ombreConfirmedWriteQueue';

export interface OmbreConfirmedFinalPreflightInput {
  item: OmbreConfirmedWriteQueueItem | null;
  finalConfirmed: boolean;
}

export interface OmbreConfirmedFinalPreflightAuditPreview {
  sourceMessageIds: Array<number | string>;
  feature: string;
  charId?: string;
  contentHash: string;
  contentPreview: string;
  riskFlags: string[];
  readbackStatus: 'not-run';
  status: 'queued';
}

export type OmbreConfirmedFinalPreflightResult =
  | {
      ok: true;
      status: 'ready-for-final-write';
      requestPreview: NonNullable<OmbreConfirmedWriteQueueItem['confirmedPreview']> extends infer T
        ? T extends { ok: true; request: infer R } ? R : never
        : never;
      auditPreview: OmbreConfirmedFinalPreflightAuditPreview;
      warnings: string[];
    }
  | {
      ok: false;
      status:
        | 'no-candidate'
        | 'candidate-not-approved'
        | 'candidate-preview-invalid'
        | 'final-confirmation-required';
      reasons: string[];
      warnings: string[];
    };

function blocked(
  status: Extract<OmbreConfirmedFinalPreflightResult, { ok: false }>['status'],
  reasons: string[],
): OmbreConfirmedFinalPreflightResult {
  return { ok: false, status, reasons, warnings: [] };
}

export function buildOmbreConfirmedFinalPreflight(
  input: OmbreConfirmedFinalPreflightInput,
): OmbreConfirmedFinalPreflightResult {
  const { item, finalConfirmed } = input;
  if (!item) {
    return blocked('no-candidate', ['No confirmed memory candidate is selected.']);
  }
  if (item.status !== 'approved') {
    return blocked('candidate-not-approved', ['Confirm the candidate before the final preflight.']);
  }
  if (!item.confirmedPreview.ok) {
    return blocked('candidate-preview-invalid', [
      `Candidate preview is invalid: ${item.confirmedPreview.reason}`,
    ]);
  }
  if (finalConfirmed !== true) {
    return blocked('final-confirmation-required', [
      'The final formal-memory confirmation checkbox is required.',
    ]);
  }

  const source = item.memoryPlan.source;
  const requestPreview = item.confirmedPreview.request;
  const auditEntry = buildOmbreConfirmedWriteAuditEntry({
    charId: source?.charId,
    feature: source?.feature ?? 'utility',
    sourceMessageIds: source?.messageIds ?? [],
    content: requestPreview.content,
    riskFlags: item.confirmedPreview.audit.dryRunRiskFlags,
    readbackStatus: 'not-run',
    status: 'queued',
  });

  return {
    ok: true,
    status: 'ready-for-final-write',
    requestPreview,
    auditPreview: {
      sourceMessageIds: auditEntry.sourceMessageIds,
      feature: auditEntry.feature,
      charId: auditEntry.charId,
      contentHash: auditEntry.contentHash,
      contentPreview: auditEntry.contentPreview,
      riskFlags: auditEntry.riskFlags,
      readbackStatus: 'not-run',
      status: 'queued',
    },
    warnings: [],
  };
}

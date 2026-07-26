import type { OmbreConfirmedHoldRequest } from './ombreConfirmedWriteClient';
import type { OmbreMemoryPlan } from './ombreTypes';

export interface OmbreConfirmedHoldMappingAudit {
  source: OmbreMemoryPlan['source'];
  dryRunReason?: string;
  dryRunRiskFlags: string[];
  removedFields: string[];
  dedupeQuery?: string;
  expectedBucketType?: OmbreMemoryPlan['expectedBucketType'];
}

export type OmbreConfirmedHoldMappingResult =
  | {
      ok: true;
      request: OmbreConfirmedHoldRequest;
      audit: OmbreConfirmedHoldMappingAudit;
    }
  | {
      ok: false;
      reason: string;
      riskFlags: string[];
    };

const REQUEST_FIELDS = new Set([
  'content',
  'tags',
  'importance',
  'pinned',
  'why_remembered',
  'meaning',
]);
const TEST_ONLY_FIELDS = new Set(['test_data']);

function reject(plan: OmbreMemoryPlan, reason: string): OmbreConfirmedHoldMappingResult {
  const riskFlags = plan.riskFlags.includes(reason)
    ? [...plan.riskFlags]
    : [...plan.riskFlags, reason];
  return { ok: false, reason, riskFlags };
}

function normalizeContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTags(value: unknown): string {
  const tags = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，]/)
      : [];
  const normalized = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean);
  const unique = new Set(normalized);
  unique.add('sullyos');
  unique.add('feature:chat');
  return Array.from(unique).join(', ');
}

function normalizeImportance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 4;
  if (value < 1 || value > 10) return 4;
  return value;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function removedFields(args: Record<string, unknown>): string[] {
  return Object.keys(args).filter(key => TEST_ONLY_FIELDS.has(key) || !REQUEST_FIELDS.has(key));
}

export function mapOmbreDryRunPlanToConfirmedHoldRequest(
  plan: OmbreMemoryPlan,
  overrides?: { content?: string },
): OmbreConfirmedHoldMappingResult {
  if (plan.mode !== 'dry-run') return reject(plan, 'plan-mode-must-be-dry-run');
  if (plan.proposedTool !== 'hold') return reject(plan, 'proposed-tool-must-be-hold');
  if (plan.source?.feature !== 'chat') return reject(plan, 'source-must-be-chat');
  if (!Array.isArray(plan.source.messageIds) || !plan.source.messageIds.length) {
    return reject(plan, 'source-message-ids-required');
  }
  if (plan.riskFlags.includes('content-too-long-for-direct-hold')) {
    return reject(plan, 'content-too-long-for-direct-hold');
  }

  const args = plan.arguments ?? {};
  const content = normalizeContent(overrides?.content ?? args.content);
  if (!content) return reject(plan, 'content-required');

  return {
    ok: true,
    request: {
      content,
      tags: normalizeTags(args.tags),
      importance: normalizeImportance(args.importance),
      pinned: false,
      why_remembered: normalizeOptionalString(args.why_remembered),
      meaning: normalizeOptionalString(args.meaning),
    },
    audit: {
      source: plan.source,
      dryRunReason: plan.reason,
      dryRunRiskFlags: [...plan.riskFlags],
      removedFields: removedFields(args),
      dedupeQuery: plan.dedupeQuery,
      expectedBucketType: plan.expectedBucketType,
    },
  };
}

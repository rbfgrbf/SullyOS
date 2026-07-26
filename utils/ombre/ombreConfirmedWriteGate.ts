import type { OmbreMemoryPlan, OmbreToolName } from './ombreTypes';

export type OmbreConfirmedWriteGateDecision =
  | {
      allowed: true;
      tool: 'hold';
      arguments: Record<string, unknown>;
      audit: {
        source: unknown;
        riskFlags: string[];
        touchedMetadata: boolean;
        requiresReadback: true;
      };
    }
  | {
      allowed: false;
      reason: string;
      riskFlags: string[];
    };

export interface OmbreConfirmedWriteGateInput {
  memoryPlan: OmbreMemoryPlan;
  humanApproved: boolean;
  strictNoTouch: boolean;
  dedupeTouchedMetadata?: boolean;
}

const FIRST_CONFIRMED_WRITE_TOOL: OmbreToolName = 'hold';
const FIRST_DRAFT_BLOCKED_TOOLS = new Set<OmbreToolName>([
  'grow',
  'trace',
  'anchor',
  'release',
  'plan',
  'letter_write',
  'I',
]);

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

function uniqueRiskFlags(flags: string[]): string[] {
  return [...new Set(flags.filter(flag => flag.trim().length > 0))];
}

function addRiskFlags(memoryPlan: OmbreMemoryPlan, flags: string[]): string[] {
  return uniqueRiskFlags([...(memoryPlan.riskFlags ?? []), ...flags]);
}

function reject(
  memoryPlan: OmbreMemoryPlan,
  reason: string,
  flags: string[] = [reason],
): OmbreConfirmedWriteGateDecision {
  return {
    allowed: false,
    reason,
    riskFlags: addRiskFlags(memoryPlan, flags),
  };
}

function contentFromArgs(args: Record<string, unknown> | undefined): string {
  const content = args?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function hasPossibleSecretContent(content: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(content));
}

function blockedToolFlags(tool: OmbreToolName): string[] {
  const flags = ['write-tool-not-allowed'];
  if (FIRST_DRAFT_BLOCKED_TOOLS.has(tool)) flags.push('first-draft-write-tool-blocked');
  if (tool === 'I') flags.push('i-content-write-blocked');
  return flags;
}

export function reviewOmbreConfirmedWriteCandidate(
  input: OmbreConfirmedWriteGateInput,
): OmbreConfirmedWriteGateDecision {
  const { memoryPlan } = input;

  if (input.humanApproved !== true) {
    return reject(memoryPlan, 'human-approval-required');
  }

  if (memoryPlan.mode !== 'dry-run') {
    return reject(memoryPlan, 'memory-plan-must-be-dry-run');
  }

  const proposedTool = memoryPlan.proposedTool;
  const content = contentFromArgs(memoryPlan.arguments);
  if (!proposedTool || content.length === 0) {
    return reject(memoryPlan, 'missing-proposed-tool-or-content');
  }

  if (proposedTool !== FIRST_CONFIRMED_WRITE_TOOL) {
    return reject(memoryPlan, 'write-tool-not-allowed', blockedToolFlags(proposedTool));
  }

  if (hasPossibleSecretContent(content)) {
    return reject(memoryPlan, 'possible-secret-content');
  }

  if (input.strictNoTouch === true && input.dedupeTouchedMetadata === true) {
    return reject(memoryPlan, 'strict-no-touch-dedupe-blocked');
  }

  return {
    allowed: true,
    tool: 'hold',
    arguments: { ...(memoryPlan.arguments ?? {}) },
    audit: {
      source: memoryPlan.source,
      riskFlags: uniqueRiskFlags(memoryPlan.riskFlags ?? []),
      touchedMetadata: input.dedupeTouchedMetadata === true,
      requiresReadback: true,
    },
  };
}

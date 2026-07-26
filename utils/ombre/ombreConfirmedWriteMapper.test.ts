import { describe, expect, it } from 'vitest';
import { mapOmbreDryRunPlanToConfirmedHoldRequest } from './ombreConfirmedWriteMapper';
import type { OmbreMemoryPlan } from './ombreTypes';

const basePlan: OmbreMemoryPlan = {
  mode: 'dry-run',
  proposedTool: 'hold',
  arguments: {
    content: 'Remember that I want Ombre confirmed writes to stay review-only first.',
    tags: ['preference', 'sullyos'],
    importance: 5,
    pinned: true,
    test_data: true,
    why_remembered: 'Dry-run proposal from SullyOS. Human approval is required before confirmed write.',
    meaning: 'A candidate memory from the latest user-authored SullyOS chat message.',
  },
  source: {
    app: 'SullyOS',
    feature: 'chat',
    charId: 'char-xiaoguai',
    messageIds: [501],
    timestamp: 1_785_040_000_501,
  },
  expectedBucketType: 'dynamic',
  dedupeQuery: 'Remember that I want Ombre confirmed writes to stay review-only first.',
  approval: { required: true, status: 'pending', gate: 'dry-run' },
  riskFlags: ['dry-run-not-written'],
};

function map(plan: OmbreMemoryPlan = basePlan) {
  return mapOmbreDryRunPlanToConfirmedHoldRequest(plan);
}

describe('mapOmbreDryRunPlanToConfirmedHoldRequest', () => {
  it('maps a normal dry-run chat hold plan to a confirmed hold request preview', () => {
    const result = map();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.request).toEqual({
      content: 'Remember that I want Ombre confirmed writes to stay review-only first.',
      tags: 'preference, sullyos, feature:chat',
      importance: 5,
      pinned: false,
      why_remembered: 'Dry-run proposal from SullyOS. Human approval is required before confirmed write.',
      meaning: 'A candidate memory from the latest user-authored SullyOS chat message.',
    });
    expect(result.audit).toMatchObject({
      source: basePlan.source,
      dryRunReason: basePlan.reason,
      dryRunRiskFlags: ['dry-run-not-written'],
      dedupeQuery: basePlan.dedupeQuery,
      expectedBucketType: 'dynamic',
    });
  });

  it('removes test_data from the request and lists it in audit.removedFields', () => {
    const result = map();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(('test_data' in (result.request as Record<string, unknown>))).toBe(false);
    expect(result.audit.removedFields).toContain('test_data');
  });

  it('rejects non-chat sources', () => {
    const result = map({
      ...basePlan,
      source: { ...basePlan.source!, feature: 'world' },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'source-must-be-chat',
      riskFlags: ['dry-run-not-written', 'source-must-be-chat'],
    });
  });

  it('rejects non-hold proposed tools', () => {
    const result = map({ ...basePlan, proposedTool: 'grow' });

    expect(result).toEqual({
      ok: false,
      reason: 'proposed-tool-must-be-hold',
      riskFlags: ['dry-run-not-written', 'proposed-tool-must-be-hold'],
    });
  });

  it.each(['confirmed', 'off'] as const)('rejects %s plans', mode => {
    const result = map({ ...basePlan, mode });

    expect(result).toEqual({
      ok: false,
      reason: 'plan-mode-must-be-dry-run',
      riskFlags: ['dry-run-not-written', 'plan-mode-must-be-dry-run'],
    });
  });

  it('rejects empty content', () => {
    const result = map({
      ...basePlan,
      arguments: { ...basePlan.arguments, content: '   ' },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'content-required',
      riskFlags: ['dry-run-not-written', 'content-required'],
    });
  });

  it('rejects chat sources without message ids', () => {
    const result = map({
      ...basePlan,
      source: { ...basePlan.source!, messageIds: undefined },
    } as any);

    expect(result).toEqual({
      ok: false,
      reason: 'source-message-ids-required',
      riskFlags: ['dry-run-not-written', 'source-message-ids-required'],
    });
  });

  it('rejects too-long direct content risk', () => {
    const result = map({
      ...basePlan,
      riskFlags: ['dry-run-not-written', 'content-too-long-for-direct-hold'],
    });

    expect(result).toEqual({
      ok: false,
      reason: 'content-too-long-for-direct-hold',
      riskFlags: ['dry-run-not-written', 'content-too-long-for-direct-hold'],
    });
  });

  it('uses edited content override while preserving original source and audit metadata', () => {
    const result = mapOmbreDryRunPlanToConfirmedHoldRequest(basePlan, {
      content: 'Edited reviewed content.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.request.content).toBe('Edited reviewed content.');
    expect(result.audit.source).toBe(basePlan.source);
    expect(result.audit.dedupeQuery).toBe(basePlan.dedupeQuery);
    expect(result.audit.dryRunRiskFlags).toEqual(basePlan.riskFlags);
  });
});

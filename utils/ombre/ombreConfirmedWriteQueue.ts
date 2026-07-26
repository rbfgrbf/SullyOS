import type { OmbreMemoryPlan } from './ombreTypes';
import {
  mapOmbreDryRunPlanToConfirmedHoldRequest,
  type OmbreConfirmedHoldMappingResult,
} from './ombreConfirmedWriteMapper';

export interface OmbreConfirmedWriteQueueItem {
  id: string;
  createdAt: number;
  memoryPlan: OmbreMemoryPlan;
  status: 'pending' | 'rejected' | 'approved' | 'written' | 'failed';
  draftContent: string;
  confirmedPreview: OmbreConfirmedHoldMappingResult;
}

function contentFromPlan(plan: OmbreMemoryPlan): string {
  const content = plan.arguments?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function canQueueMemoryPlan(plan: OmbreMemoryPlan): boolean {
  if (plan.mode !== 'dry-run') return false;
  if (plan.proposedTool !== 'hold') return false;
  if (plan.source?.feature !== 'chat') return false;
  if (contentFromPlan(plan).length === 0) return false;
  if (plan.riskFlags.includes('content-too-long-for-direct-hold')) return false;
  return mapOmbreDryRunPlanToConfirmedHoldRequest(plan).ok;
}

function queueId(createdAt: number, plan: OmbreMemoryPlan): string {
  const sourceId = plan.source?.messageIds?.[0] ?? 'unknown';
  return `ombre-confirmed-queue-${createdAt}-${sourceId}`;
}

export function enqueueOmbreMemoryPlan(plan: OmbreMemoryPlan): OmbreConfirmedWriteQueueItem | null {
  if (!canQueueMemoryPlan(plan)) return null;
  const confirmedPreview = mapOmbreDryRunPlanToConfirmedHoldRequest(plan);
  if (!confirmedPreview.ok) return null;
  const createdAt = Date.now();
  return {
    id: queueId(createdAt, plan),
    createdAt,
    memoryPlan: plan,
    status: 'pending',
    draftContent: confirmedPreview.request.content,
    confirmedPreview,
  };
}

export function approveOmbreQueueItem(item: OmbreConfirmedWriteQueueItem): OmbreConfirmedWriteQueueItem {
  const confirmedPreview = mapOmbreDryRunPlanToConfirmedHoldRequest(item.memoryPlan, {
    content: item.draftContent,
  });
  return {
    ...item,
    status: confirmedPreview.ok ? 'approved' : 'failed',
    confirmedPreview,
  };
}

export function rejectOmbreQueueItem(item: OmbreConfirmedWriteQueueItem): OmbreConfirmedWriteQueueItem {
  return { ...item, status: 'rejected' };
}

export function updateOmbreQueueItemDraft(
  item: OmbreConfirmedWriteQueueItem,
  draftContent: string,
): OmbreConfirmedWriteQueueItem {
  return {
    ...item,
    draftContent,
    confirmedPreview: mapOmbreDryRunPlanToConfirmedHoldRequest(item.memoryPlan, { content: draftContent }),
  };
}

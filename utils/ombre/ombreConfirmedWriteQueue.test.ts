import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveOmbreProviderConfig } from './ombreConfig';
import {
  approveOmbreQueueItem,
  enqueueOmbreMemoryPlan,
  rejectOmbreQueueItem,
} from './ombreConfirmedWriteQueue';
import type { OmbreMemoryPlan } from './ombreTypes';

const dryRunHoldPlan: OmbreMemoryPlan = {
  mode: 'dry-run',
  proposedTool: 'hold',
  arguments: {
    content: 'Remember that confirmed writes require a visible approval queue.',
    tags: ['sullyos', 'feature:chat'],
    importance: 4,
    pinned: false,
    test_data: true,
  },
  source: {
    app: 'SullyOS',
    feature: 'chat',
    charId: 'char-xiaoguai',
    messageIds: [401],
    timestamp: 1_785_040_000_401,
  },
  approval: { required: true, status: 'pending', gate: 'dry-run' },
  expectedBucketType: 'dynamic',
  dedupeQuery: 'Remember that confirmed writes require a visible approval queue.',
  riskFlags: ['dry-run-not-written'],
};

describe('Ombre confirmed write queue', () => {
  it('queues only dry-run hold candidates with non-empty content', () => {
    const item = enqueueOmbreMemoryPlan(dryRunHoldPlan);

    expect(item).toMatchObject({
      memoryPlan: dryRunHoldPlan,
      status: 'pending',
      draftContent: 'Remember that confirmed writes require a visible approval queue.',
    });
    expect(item?.id).toMatch(/^ombre-confirmed-queue-/);
    expect(typeof item?.createdAt).toBe('number');
    expect(item?.confirmedPreview.ok).toBe(true);
  });

  it('rejects non-dry-run, non-hold, empty, too-long, and non-chat candidates', () => {
    expect(enqueueOmbreMemoryPlan({ ...dryRunHoldPlan, mode: 'confirmed' })).toBeNull();
    expect(enqueueOmbreMemoryPlan({ ...dryRunHoldPlan, proposedTool: 'grow' })).toBeNull();
    expect(enqueueOmbreMemoryPlan({
      ...dryRunHoldPlan,
      arguments: { ...dryRunHoldPlan.arguments, content: '   ' },
    })).toBeNull();
    expect(enqueueOmbreMemoryPlan({
      ...dryRunHoldPlan,
      riskFlags: ['dry-run-not-written', 'content-too-long-for-direct-hold'],
    })).toBeNull();
    expect(enqueueOmbreMemoryPlan({
      ...dryRunHoldPlan,
      source: { ...dryRunHoldPlan.source!, feature: 'world' },
    })).toBeNull();
  });

  it('approves and rejects queue items without mutating the original item', () => {
    const item = enqueueOmbreMemoryPlan(dryRunHoldPlan);
    if (!item) throw new Error('expected queued item');

    const approved = approveOmbreQueueItem(item);
    const rejected = rejectOmbreQueueItem(item);

    expect(item.status).toBe('pending');
    expect(approved).toEqual({ ...item, status: 'approved' });
    expect(rejected).toEqual({ ...item, status: 'rejected' });
  });

  it('uses the mapper on approval and keeps test_data out of the cleaned preview', () => {
    const item = enqueueOmbreMemoryPlan(dryRunHoldPlan);
    if (!item) throw new Error('expected queued item');

    const approved = approveOmbreQueueItem({
      ...item,
      draftContent: 'Edited approved candidate text.',
    });

    expect(approved.status).toBe('approved');
    expect(approved.confirmedPreview.ok).toBe(true);
    if (!approved.confirmedPreview.ok) throw new Error(approved.confirmedPreview.reason);
    expect(approved.confirmedPreview.request.content).toBe('Edited approved candidate text.');
    expect(('test_data' in (approved.confirmedPreview.request as Record<string, unknown>))).toBe(false);
    expect(approved.confirmedPreview.audit.removedFields).toContain('test_data');
  });

  it('does not call fetch while queueing or changing review state', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    const item = enqueueOmbreMemoryPlan(dryRunHoldPlan);
    if (!item) throw new Error('expected queued item');
    approveOmbreQueueItem(item);
    rejectOmbreQueueItem(item);

    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the old locks: Settings does not expose confirmed and config still downgrades confirmed', () => {
    const settingsSource = readFileSync(join(process.cwd(), 'apps', 'Settings.tsx'), 'utf8');
    const writeOptions = settingsSource.match(/const OMBRE_WRITE_OPTIONS = \[(.*?)\] as const;/s)?.[1] ?? '';
    const config = resolveOmbreProviderConfig({
      id: 'char-xiaoguai',
      name: 'Xiaoguai',
      ombreProviderEnabled: true,
      ombreCorePrompt: 'Ombre core',
      ombreMemoryWriteMode: 'confirmed',
    } as any);

    expect(writeOptions).toContain("'off'");
    expect(writeOptions).toContain("'dry-run'");
    expect(writeOptions).not.toContain('confirmed');
    expect(config.memoryWriteMode).toBe('off');
  });
});

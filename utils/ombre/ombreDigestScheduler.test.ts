import { describe, expect, it, vi } from 'vitest';
import type { DigestTriggerReason } from './ombreDigestTypes';
import { createOmbreDigestScheduler } from './ombreDigestScheduler';

describe('ombre digest scheduler', () => {
    it('runs simultaneous requests for one character only once', async () => {
        let resolveRun!: () => void;
        const run = vi.fn((_charId: string, _reason: DigestTriggerReason) => new Promise<void>(resolve => { resolveRun = resolve; }));
        const scheduler = createOmbreDigestScheduler({ targetCharId: 'char-a', run: async (...args) => { await run(...args); return { status: 'checkpointed' }; } } as any);

        const first = scheduler.request('char-a', 'round-threshold');
        const second = scheduler.request('char-a', 'period-boundary');
        expect(run).toHaveBeenCalledTimes(0);
        await Promise.resolve();
        resolveRun();
        await Promise.all([first, second]);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('char-a', 'round-threshold');
    });

    it('ignores requests for non-target characters', async () => {
        const run = vi.fn(async () => ({ status: 'disabled' as const }));
        const scheduler = createOmbreDigestScheduler({ targetCharId: 'char-a', run } as any);

        await scheduler.request('char-b', 'round-threshold');
        await scheduler.request('char-a', 'round-threshold');
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('char-a', 'round-threshold');
    });

    it('does not start work after dispose and recovers only the target character', async () => {
        const run = vi.fn(async () => ({ status: 'disabled' as const }));
        const scheduler = createOmbreDigestScheduler({ targetCharId: 'char-a', run } as any);
        await scheduler.recover(['char-a', 'char-b']);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('char-a', 'startup-recovery');
        scheduler.dispose();
        await scheduler.request('char-c', 'startup-recovery');
        expect(run).toHaveBeenCalledTimes(1);
    });
});

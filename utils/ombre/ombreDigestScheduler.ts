import type { DigestRunResult } from './ombreDigestRunner';
import type { DigestTriggerReason } from './ombreDigestTypes';

export interface OmbreDigestSchedulerDeps {
    targetCharId: string;
    run: (charId: string, reason: DigestTriggerReason) => Promise<DigestRunResult>;
}

export function createOmbreDigestScheduler(deps: OmbreDigestSchedulerDeps): {
    request: (charId: string, reason: DigestTriggerReason) => Promise<void>;
    recover: (charIds: string[]) => Promise<void>;
    dispose: () => void;
} {
    const inFlight = new Map<string, Promise<void>>();
    let disposed = false;

    const request = (charId: string, reason: DigestTriggerReason): Promise<void> => {
        if (disposed || charId !== deps.targetCharId) return Promise.resolve();
        const existing = inFlight.get(charId);
        if (existing) return existing;

        let promise!: Promise<void>;
        promise = Promise.resolve()
            .then(() => deps.run(charId, reason))
            .then(() => undefined)
            .finally(() => {
                if (inFlight.get(charId) === promise) inFlight.delete(charId);
            });
        inFlight.set(charId, promise);
        return promise;
    };

    const recover = (charIds: string[]): Promise<void> => Promise.all(
        charIds
            .filter(charId => charId === deps.targetCharId)
            .map(charId => request(charId, 'startup-recovery')),
    ).then(() => undefined);

    const dispose = (): void => {
        disposed = true;
        inFlight.clear();
    };

    return { request, recover, dispose };
}

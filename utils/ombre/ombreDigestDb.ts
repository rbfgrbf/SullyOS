import { openDB } from '../db';
import type { OmbreDigestJob, DigestJobStatus } from './ombreDigestTypes';

const STORE_OMBRE_DIGEST_JOBS = 'ombre_digest_jobs';

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}

export async function putOmbreDigestJob(job: OmbreDigestJob): Promise<void> {
    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_JOBS, 'readwrite');
    transaction.objectStore(STORE_OMBRE_DIGEST_JOBS).put(job);
    await waitForTransaction(transaction);
}

export async function getOmbreDigestJob(id: string): Promise<OmbreDigestJob | undefined> {
    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_JOBS, 'readonly');
    const request = transaction.objectStore(STORE_OMBRE_DIGEST_JOBS).get(id);
    const result = await new Promise<OmbreDigestJob | undefined>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as OmbreDigestJob | undefined);
        request.onerror = () => reject(request.error);
    });
    await waitForTransaction(transaction);
    return result;
}

export async function updateOmbreDigestJob(id: string, patch: Partial<OmbreDigestJob>): Promise<OmbreDigestJob> {
    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_JOBS, 'readwrite');
    const store = transaction.objectStore(STORE_OMBRE_DIGEST_JOBS);
    const existing = await new Promise<OmbreDigestJob>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => {
            if (!request.result) {
                reject(new Error(`Ombre digest job not found: ${id}`));
                return;
            }
            resolve(request.result as OmbreDigestJob);
        };
        request.onerror = () => reject(request.error);
    });
    const updated: OmbreDigestJob = { ...existing, ...patch, id };
    store.put(updated);
    await waitForTransaction(transaction);
    return updated;
}

export async function listOmbreDigestJobs(charId: string, statuses?: DigestJobStatus[]): Promise<OmbreDigestJob[]> {
    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_JOBS, 'readonly');
    const store = transaction.objectStore(STORE_OMBRE_DIGEST_JOBS);
    const request = store.index('charId').getAll(IDBKeyRange.only(charId));
    const jobs = await new Promise<OmbreDigestJob[]>((resolve, reject) => {
        request.onsuccess = () => resolve((request.result || []) as OmbreDigestJob[]);
        request.onerror = () => reject(request.error);
    });
    await waitForTransaction(transaction);
    return (statuses && statuses.length > 0)
        ? jobs.filter(job => statuses.includes(job.status))
        : jobs;
}

export async function getLatestCompletedOmbreDigestJob(charId: string): Promise<OmbreDigestJob | undefined> {
    const jobs = await listOmbreDigestJobs(charId, ['checkpointed', 'stage-candidate', 'written', 'readback-passed', 'write-unknown', 'needs-review']);
    return jobs.sort((a, b) => b.sourceEndMessageId - a.sourceEndMessageId)[0];
}

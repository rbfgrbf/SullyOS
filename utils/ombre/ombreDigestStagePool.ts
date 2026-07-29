import { openDB } from '../db';

const STORE_OMBRE_DIGEST_STAGE_ACTIONS = 'ombre_digest_stage_actions';
const STAGE_WINDOW_DAYS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OmbreDigestStageWindowStatus = 'observed' | 'candidate' | 'promote' | 'expired';

export interface OmbreDigestStageRecord {
    id: string;
    charId: string;
    signature: string;
    localDate: string;
    claim: string;
    sourceMessageIds: Array<number | string>;
    importance: number;
    tags: string[];
    dedupeQuery: string;
    riskFlags: string[];
    occurrenceCount: number;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
}

export interface OmbreDigestStageCandidateInput {
    charId: string;
    signature: string;
    localDate: string;
    claim: string;
    sourceMessageIds: Array<number | string>;
    importance: number;
    tags: string[];
    dedupeQuery: string;
    riskFlags: string[];
    now: number;
}

export interface OmbreDigestStageCandidateWindowInput {
    charId: string;
    signature: string;
    referenceLocalDate: string;
}

export interface OmbreDigestStageCandidateWindow {
    status: OmbreDigestStageWindowStatus;
    charId: string;
    signature: string;
    referenceLocalDate: string;
    localDates: string[];
    uniqueDayCount: number;
    activeRecords: OmbreDigestStageRecord[];
    expiredRecords: OmbreDigestStageRecord[];
    latestRecord?: OmbreDigestStageRecord;
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}

function normalize(text: string): string {
    return String(text).replace(/\s+/g, ' ').trim();
}

function parseLocalDate(date: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    return Date.UTC(year, month - 1, day);
}

function dayDiff(referenceLocalDate: string, localDate: string): number | null {
    const ref = parseLocalDate(referenceLocalDate);
    const value = parseLocalDate(localDate);
    if (ref === null || value === null) return null;
    return Math.floor((ref - value) / DAY_MS);
}

function isWithinRollingWindow(referenceLocalDate: string, localDate: string): boolean {
    const diff = dayDiff(referenceLocalDate, localDate);
    return diff !== null && diff >= 0 && diff < STAGE_WINDOW_DAYS;
}

function uniqueStrings(values: Array<string | number>): Array<string | number> {
    return [...new Set(values)];
}

function mergeRecord(existing: OmbreDigestStageRecord, input: OmbreDigestStageCandidateInput): OmbreDigestStageRecord {
    return {
        ...existing,
        charId: input.charId,
        signature: input.signature,
        localDate: input.localDate,
        claim: input.claim,
        sourceMessageIds: uniqueStrings([...existing.sourceMessageIds, ...input.sourceMessageIds]),
        importance: Math.max(existing.importance, input.importance),
        tags: [...new Set([...existing.tags, ...input.tags])],
        dedupeQuery: input.dedupeQuery || existing.dedupeQuery,
        riskFlags: [...new Set([...existing.riskFlags, ...input.riskFlags])],
        occurrenceCount: existing.occurrenceCount + 1,
        updatedAt: input.now,
        expiresAt: input.now + STAGE_WINDOW_DAYS * DAY_MS,
    };
}

function createRecordId(charId: string, signature: string, localDate: string): string {
    return `${charId}::${signature}::${localDate}`;
}

async function getStageRecordById(id: string): Promise<OmbreDigestStageRecord | undefined> {
    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_STAGE_ACTIONS, 'readonly');
    const request = transaction.objectStore(STORE_OMBRE_DIGEST_STAGE_ACTIONS).get(id);
    const result = await new Promise<OmbreDigestStageRecord | undefined>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as OmbreDigestStageRecord | undefined);
        request.onerror = () => reject(request.error);
    });
    await waitForTransaction(transaction);
    return result;
}

async function getStageRecordsByCharId(charId: string): Promise<OmbreDigestStageRecord[]> {
    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_STAGE_ACTIONS, 'readonly');
    const request = transaction.objectStore(STORE_OMBRE_DIGEST_STAGE_ACTIONS)
        .index('charId')
        .getAll(IDBKeyRange.only(charId));
    const result = await new Promise<OmbreDigestStageRecord[]>((resolve, reject) => {
        request.onsuccess = () => resolve((request.result || []) as OmbreDigestStageRecord[]);
        request.onerror = () => reject(request.error);
    });
    await waitForTransaction(transaction);
    return result;
}

function sortRecords(records: OmbreDigestStageRecord[]): OmbreDigestStageRecord[] {
    return [...records].sort((a, b) => {
        const dateDelta = a.localDate.localeCompare(b.localDate);
        if (dateDelta !== 0) return dateDelta;
        const updateDelta = a.updatedAt - b.updatedAt;
        if (updateDelta !== 0) return updateDelta;
        return a.id.localeCompare(b.id);
    });
}

export function buildOmbreDigestStageSignature(claim: string): string {
    let value = normalize(claim);
    const replacements: Array<[RegExp, string]> = [
        [/[，。！？、,.!?；;:：]/g, ' '],
        [/(今天早上|今早|早上|上午|中午|下午|晚上|昨天晚上|昨天|前天|刚刚|刚才|最近|这几天|连续|每天|今日|本周|这一周|上周|本月|这个月)/g, ' '],
        [/(用户|我爸|父亲|爸爸|爸|我妈|母亲|妈妈|妈|家人|朋友|同事|室友)/g, ' '],
        [/(我|你|他|她|我们|他们|她们)/g, ' '],
        [/(给)(我|你|他|她|我们|他们|她们)/g, '$1'],
        [/(买|吃|喝|点|带|拿|做|送|接|陪)了/g, '$1'],
        [/又|还|再|还是|依然|仍然|一直|总是|照旧|继续/g, ' '],
        [/\s+/g, ''],
    ];
    for (const [pattern, replacement] of replacements) {
        value = value.replace(pattern, replacement);
    }
    return value || normalize(claim).slice(0, 80);
}

function evaluateWindow(
    records: OmbreDigestStageRecord[],
    referenceLocalDate: string,
): Omit<OmbreDigestStageCandidateWindow, 'charId' | 'signature' | 'referenceLocalDate'> {
    const activeRecords = sortRecords(records.filter(record => isWithinRollingWindow(referenceLocalDate, record.localDate)));
    const expiredRecords = sortRecords(records.filter(record => !isWithinRollingWindow(referenceLocalDate, record.localDate)));
    const localDates = [...new Set(activeRecords.map(record => record.localDate))].sort();
    const uniqueDayCount = localDates.length;
    let status: OmbreDigestStageWindowStatus = 'observed';
    if (uniqueDayCount >= STAGE_WINDOW_DAYS) status = 'promote';
    else if (uniqueDayCount >= 3) status = 'candidate';
    else if (activeRecords.length === 0 && expiredRecords.length > 0) status = 'expired';
    return {
        status,
        localDates,
        uniqueDayCount,
        activeRecords,
        expiredRecords,
        latestRecord: activeRecords.at(-1),
    };
}

export async function getOmbreDigestStageCandidateWindow(
    input: OmbreDigestStageCandidateWindowInput,
): Promise<OmbreDigestStageCandidateWindow> {
    const records = await getStageRecordsByCharId(input.charId);
    const matching = records.filter(record => record.signature === input.signature);
    return {
        charId: input.charId,
        signature: input.signature,
        referenceLocalDate: input.referenceLocalDate,
        ...evaluateWindow(matching, input.referenceLocalDate),
    };
}

export async function pruneOmbreDigestStageCandidates(input: {
    charId: string;
    referenceLocalDate: string;
}): Promise<number> {
    const records = await getStageRecordsByCharId(input.charId);
    const expired = records.filter(record => !isWithinRollingWindow(input.referenceLocalDate, record.localDate));
    if (expired.length === 0) return 0;

    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_STAGE_ACTIONS, 'readwrite');
    const store = transaction.objectStore(STORE_OMBRE_DIGEST_STAGE_ACTIONS);
    for (const record of expired) {
        store.delete(record.id);
    }
    await waitForTransaction(transaction);
    return expired.length;
}

export async function clearOmbreDigestStageCandidates(input: {
    charId: string;
    signature: string;
}): Promise<number> {
    const records = await getStageRecordsByCharId(input.charId);
    const matches = records.filter(record => record.signature === input.signature);
    if (matches.length === 0) return 0;

    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_STAGE_ACTIONS, 'readwrite');
    const store = transaction.objectStore(STORE_OMBRE_DIGEST_STAGE_ACTIONS);
    for (const record of matches) {
        store.delete(record.id);
    }
    await waitForTransaction(transaction);
    return matches.length;
}

export async function recordOmbreDigestStageCandidate(
    input: OmbreDigestStageCandidateInput,
): Promise<OmbreDigestStageCandidateWindow> {
    const id = createRecordId(input.charId, input.signature, input.localDate);
    const existing = await getStageRecordById(id);
    const record: OmbreDigestStageRecord = existing
        ? mergeRecord(existing, input)
        : {
            id,
            charId: input.charId,
            signature: input.signature,
            localDate: input.localDate,
            claim: input.claim,
            sourceMessageIds: uniqueStrings(input.sourceMessageIds),
            importance: input.importance,
            tags: [...new Set(input.tags)],
            dedupeQuery: input.dedupeQuery,
            riskFlags: [...new Set(input.riskFlags)],
            occurrenceCount: 1,
            createdAt: input.now,
            updatedAt: input.now,
            expiresAt: input.now + STAGE_WINDOW_DAYS * DAY_MS,
        };

    const db = await openDB();
    const transaction = db.transaction(STORE_OMBRE_DIGEST_STAGE_ACTIONS, 'readwrite');
    transaction.objectStore(STORE_OMBRE_DIGEST_STAGE_ACTIONS).put(record);
    await waitForTransaction(transaction);

    await pruneOmbreDigestStageCandidates({
        charId: input.charId,
        referenceLocalDate: input.localDate,
    });

    return getOmbreDigestStageCandidateWindow({
        charId: input.charId,
        signature: input.signature,
        referenceLocalDate: input.localDate,
    });
}

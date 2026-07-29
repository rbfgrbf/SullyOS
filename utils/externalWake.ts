import type { CharacterProfile } from '../types';

export const EXTERNAL_WAKE_DEFAULT_ADAPTER_URL = 'http://127.0.0.1:17873';
export const EXTERNAL_WAKE_ENABLED_KEY = 'os_external_wake_enabled';
export const EXTERNAL_WAKE_URL_KEY = 'os_external_wake_url';
export const EXTERNAL_WAKE_POLL_MS_KEY = 'os_external_wake_poll_ms';
export const EXTERNAL_WAKE_CHAR_ID_KEY = 'os_external_wake_char_id';

const MAX_WAKE_REASON_LENGTH = 128;
const MAX_WAKE_MESSAGE_LENGTH = 4_096;
const MAX_WAKE_ID_LENGTH = 160;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const DEFAULT_DEDUPE_TTL_MS = 10 * 60_000;

export interface ExternalWakeEvent {
  version: 1;
  type: 'garden_wake';
  id: string;
  reason: string;
  message: string;
  source: string;
  receivedAt: number;
  targetCharId?: string;
}

export interface ExternalWakeClientConfig {
  enabled: boolean;
  adapterUrl: string;
  intervalMs: number;
  targetCharId?: string;
}

export type ExternalWakePollResult =
  | { status: 'delivered'; wakeId: string }
  | { status: 'duplicate'; wakeId: string }
  | { status: 'empty' }
  | { status: 'invalid' };

type StorageLike = Pick<Storage, 'getItem'>;
type LocationLike = Pick<Location, 'hostname'>;
type TimerHandle = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim() !== value || value.trim().length === 0) return null;
  if (value.length > maxLength) return null;
  return value;
}

function readOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function normalizeAdapterUrl(raw: string | undefined | null): string {
  const candidate = raw?.trim() || EXTERNAL_WAKE_DEFAULT_ADAPTER_URL;
  const url = new URL(candidate);
  if (url.username || url.password || url.hash) {
    throw new Error('External wake adapter URL must not contain credentials or a fragment');
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('External wake adapter only allows http:// loopback URLs');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('External wake adapter URL must use http:// or https://');
  }
  return url.toString().replace(/\/+$/, '');
}

function safeGet(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function defaultLocalStorage(): StorageLike | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function defaultLocation(): LocationLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.location : undefined;
  } catch {
    return undefined;
  }
}

function parsePollInterval(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(Math.max(parsed, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
}

export function normalizeExternalWakeEvent(input: unknown, now: () => number = Date.now): ExternalWakeEvent | null {
  if (!isRecord(input)) return null;
  if (input.version !== 1 || input.type !== 'garden_wake') return null;

  const reason = readString(input.reason, MAX_WAKE_REASON_LENGTH);
  const message = readString(input.message, MAX_WAKE_MESSAGE_LENGTH);
  if (!reason || !message) return null;

  const receivedAt = typeof input.receivedAt === 'number' && Number.isFinite(input.receivedAt)
    ? input.receivedAt
    : now();
  const source = readOptionalString(input.source, 64) || 'garden';
  const id = readOptionalString(input.id, MAX_WAKE_ID_LENGTH)
    || `${source}:${reason}:${Math.floor(receivedAt / 1000)}`;
  const targetCharId = readOptionalString(input.targetCharId ?? input.charId, 128);

  return {
    version: 1,
    type: 'garden_wake',
    id,
    reason,
    message,
    source,
    receivedAt,
    ...(targetCharId ? { targetCharId } : {}),
  };
}

export class ExternalWakeDeduper {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_DEDUPE_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  accept(wake: Pick<ExternalWakeEvent, 'id'>): boolean {
    const now = this.#now();
    for (const [key, seenAt] of this.#seen) {
      if (now - seenAt > this.#ttlMs) this.#seen.delete(key);
    }

    if (this.#seen.has(wake.id)) return false;
    this.#seen.set(wake.id, now);
    return true;
  }
}

export function resolveExternalWakeCharacterId(input: {
  wake: Partial<Pick<ExternalWakeEvent, 'targetCharId'>>;
  characters: Array<Pick<CharacterProfile, 'id'>>;
  storedCharId?: string | null;
  activeCharacterId?: string | null;
}): string | null {
  const ids = new Set(input.characters.map(char => char.id));
  const candidates = [
    input.wake.targetCharId,
    input.storedCharId,
    input.activeCharacterId,
  ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

  return candidates.find(id => ids.has(id)) || null;
}

export function buildExternalWakeHint(input: {
  wake: ExternalWakeEvent;
  userName: string;
  timeText: string;
}): string {
  const { wake, userName, timeText } = input;
  return `[系统提示（非${userName}发言）: 现在是 ${timeText}。这是来自 Garden/论坛的外部唤醒任务，不是${userName}主动找你聊天，也不是 P2 定时主动消息。唤醒原因：${wake.reason}。任务内容：${wake.message}。请只处理这一次任务；如果需要使用已配置的 Garden MCP/论坛 MCP，先查看当前状态，再做本轮必要动作。最多完成本轮必要的一次行动，然后停止；不要自行循环等待，不要反复检查工具列表，不要因为这条提示写 Ombre 正式记忆。]`;
}

export function loadExternalWakeTargetCharId(storage: StorageLike | undefined = defaultLocalStorage()): string | undefined {
  return readOptionalString(safeGet(storage, EXTERNAL_WAKE_CHAR_ID_KEY), 128);
}

export function loadExternalWakeClientConfig(input: {
  storage?: StorageLike;
  location?: LocationLike;
} = {}): ExternalWakeClientConfig {
  const storage = input.storage ?? defaultLocalStorage();
  const rawEnabled = safeGet(storage, EXTERNAL_WAKE_ENABLED_KEY);
  const enabled = rawEnabled === '1';

  return {
    enabled,
    adapterUrl: normalizeAdapterUrl(safeGet(storage, EXTERNAL_WAKE_URL_KEY)),
    intervalMs: parsePollInterval(safeGet(storage, EXTERNAL_WAKE_POLL_MS_KEY)),
    targetCharId: loadExternalWakeTargetCharId(storage),
  };
}

export async function pollExternalWakeOnce(input: {
  adapterUrl: string;
  fetchImpl?: typeof fetch;
  deduper?: ExternalWakeDeduper;
  onWake: (wake: ExternalWakeEvent) => void | Promise<void>;
}): Promise<ExternalWakePollResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const adapterUrl = normalizeAdapterUrl(input.adapterUrl);
  const response = await fetchImpl(`${adapterUrl}/wake/next`, {
    method: 'GET',
    cache: 'no-store',
    __sullySilentNetworkError: true,
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`External wake adapter HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rawWake = isRecord(payload) && 'wake' in payload ? payload.wake : payload;
  if (rawWake === null || rawWake === undefined) return { status: 'empty' };

  const wake = normalizeExternalWakeEvent(rawWake);
  if (!wake) return { status: 'invalid' };
  if (input.deduper && !input.deduper.accept(wake)) {
    return { status: 'duplicate', wakeId: wake.id };
  }

  await input.onWake(wake);
  return { status: 'delivered', wakeId: wake.id };
}

export function createExternalWakePoller(input: {
  adapterUrl: string;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  onWake: (wake: ExternalWakeEvent) => void | Promise<void>;
  onError?: (error: unknown) => void;
  setTimer?: (handler: () => void, timeoutMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}) {
  const intervalMs = Math.min(Math.max(input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
  const deduper = new ExternalWakeDeduper();
  const setTimer = input.setTimer ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs));
  const clearTimer = input.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: TimerHandle | null = null;
  let active = false;

  const schedule = () => {
    if (!active || timer !== null) return;
    timer = setTimer(tick, intervalMs);
  };

  const tick = () => {
    timer = null;
    void pollExternalWakeOnce({
      adapterUrl: input.adapterUrl,
      fetchImpl: input.fetchImpl,
      deduper,
      onWake: input.onWake,
    }).catch(error => {
      input.onError?.(error);
    }).finally(schedule);
  };

  return {
    start() {
      if (active) return;
      active = true;
      schedule();
    },
    stop() {
      active = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}

import type { OmbreProviderDefaults } from './ombreTypes';

export const OMBRE_GLOBAL_CONFIG_KEY = 'ombre_provider_global_config_v1';

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

export function normalizeOmbreGlobalConfig(value: Record<string, unknown> | null | undefined): OmbreProviderDefaults {
  const source = value || {};
  return {
    enabled: source.enabled === true,
    corePrompt: readTrimmed(source.corePrompt) || '',
    mcpEndpoint: readTrimmed(source.mcpEndpoint),
    proxyEndpoint: readTrimmed(source.proxyEndpoint),
    memoryRecallMode: typeof source.memoryRecallMode === 'string' ? source.memoryRecallMode : 'off',
    memoryWriteMode: typeof source.memoryWriteMode === 'string' ? source.memoryWriteMode : 'off',
    maxResults: source.maxResults as number | string | undefined,
    maxMemoryChars: source.maxMemoryChars as number | string | undefined,
    strictNoTouch: source.strictNoTouch === true,
  };
}

export function loadOmbreGlobalConfig(): OmbreProviderDefaults {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(OMBRE_GLOBAL_CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return normalizeOmbreGlobalConfig(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function saveOmbreGlobalConfig(input: OmbreProviderDefaults): OmbreProviderDefaults {
  const config = normalizeOmbreGlobalConfig(input as Record<string, unknown>);
  const storage = getStorage();
  if (storage) {
    storage.setItem(OMBRE_GLOBAL_CONFIG_KEY, JSON.stringify({
      ...config,
      updatedAt: Date.now(),
    }));
  }
  return config;
}

export function exportOmbreLocal(): Record<string, string> | undefined {
  const storage = getStorage();
  if (!storage) return undefined;

  try {
    const raw = storage.getItem(OMBRE_GLOBAL_CONFIG_KEY);
    return raw ? { [OMBRE_GLOBAL_CONFIG_KEY]: raw } : undefined;
  } catch {
    return undefined;
  }
}

export function importOmbreLocal(data: Record<string, string> | null | undefined): void {
  if (!data || typeof data !== 'object') return;
  const storage = getStorage();
  if (!storage) return;

  try {
    const raw = data[OMBRE_GLOBAL_CONFIG_KEY];
    if (typeof raw !== 'string') return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    storage.setItem(OMBRE_GLOBAL_CONFIG_KEY, JSON.stringify({
      ...normalizeOmbreGlobalConfig(parsed as Record<string, unknown>),
      updatedAt: Date.now(),
    }));
  } catch {
    // Ignore malformed imported local config; chat can still fall back safely.
  }
}

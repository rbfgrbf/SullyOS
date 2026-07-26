import { describe, expect, it } from 'vitest';
import {
  OMBRE_GLOBAL_CONFIG_KEY,
  exportOmbreLocal,
  importOmbreLocal,
  loadOmbreGlobalConfig,
  saveOmbreGlobalConfig,
} from './ombreGlobalConfig';

function withMemoryStorage(fn: (store: Map<string, string>) => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  });

  try {
    fn(store);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
}

describe('ombre global config persistence', () => {
  it('saves and loads normalized global Ombre defaults', () => {
    withMemoryStorage(() => {
      saveOmbreGlobalConfig({
        enabled: true,
        corePrompt: '  Ombre core  ',
        memoryRecallMode: 'search',
        memoryWriteMode: 'dry-run',
        maxResults: 5,
        maxMemoryChars: 3000,
      });

      const loaded = loadOmbreGlobalConfig();

      expect(loaded.enabled).toBe(true);
      expect(loaded.corePrompt).toBe('Ombre core');
      expect(loaded.memoryRecallMode).toBe('search');
      expect(loaded.memoryWriteMode).toBe('dry-run');
      expect(loaded.maxResults).toBe(5);
      expect(loaded.maxMemoryChars).toBe(3000);
    });
  });

  it('exports and imports the saved local Ombre config for full backups', () => {
    withMemoryStorage((store) => {
      store.set(OMBRE_GLOBAL_CONFIG_KEY, JSON.stringify({ enabled: true, corePrompt: 'Saved core' }));

      const exported = exportOmbreLocal();
      store.clear();
      importOmbreLocal(exported);

      expect(JSON.parse(store.get(OMBRE_GLOBAL_CONFIG_KEY) || '{}')).toMatchObject({
        enabled: true,
        corePrompt: 'Saved core',
      });
    });
  });
});

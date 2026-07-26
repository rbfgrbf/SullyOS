import { describe, expect, it } from 'vitest';
import { resolveOmbreProviderConfig } from './ombreConfig';

describe('resolveOmbreProviderConfig', () => {
  const GLOBAL_STORAGE_KEY = 'ombre_provider_global_config_v1';
  const globalDefaults = {
    enabled: true,
    corePrompt: 'Global Ombre canonical core',
    mcpEndpoint: 'http://localhost:18080/mcp',
    proxyEndpoint: 'http://localhost:18081/ombre',
    memoryRecallMode: 'search',
    memoryWriteMode: 'dry-run',
    maxResults: 5,
    maxMemoryChars: 3000,
    strictNoTouch: true,
  };

  it('stays disabled when no explicit Ombre core prompt exists', () => {
    const config = resolveOmbreProviderConfig({
      id: 'c1',
      name: 'Xiaoguai',
      systemPrompt: 'legacy SullyOS prompt',
    } as any, { name: 'me' } as any);

    expect(config.enabled).toBe(false);
    expect(config.corePrompt).toBe('');
    expect(config.memoryWriteMode).toBe('off');
    expect(config.memoryRecallMode).toBe('off');
    expect(config.maxResults).toBe(3);
    expect(config.maxMemoryChars).toBe(1200);
    expect(config.strictNoTouch).toBe(false);
  });

  it('uses explicit character Ombre core prompt without falling back to char.systemPrompt', () => {
    const config = resolveOmbreProviderConfig({
      id: 'c1',
      name: 'Xiaoguai',
      systemPrompt: 'legacy SullyOS prompt',
      ombreProviderEnabled: true,
      ombreCorePrompt: 'Ombre canonical core',
    } as any, { name: 'me' } as any);

    expect(config.enabled).toBe(true);
    expect(config.corePrompt).toBe('Ombre canonical core');
  });

  it('can use explicit user Ombre core prompt when character core is absent', () => {
    const config = resolveOmbreProviderConfig({
      id: 'c1',
      name: 'Xiaoguai',
      ombreProviderEnabled: true,
    } as any, { name: 'me', ombreCorePrompt: 'User profile Ombre core' } as any);

    expect(config.enabled).toBe(true);
    expect(config.corePrompt).toBe('User profile Ombre core');
  });

  it('uses global Ombre defaults for a new character without hidden per-character fields', () => {
    const config = resolveOmbreProviderConfig({
      id: 'c1',
      name: 'Xiaoguai',
      systemPrompt: 'legacy SullyOS prompt',
    } as any, { name: 'me' } as any, globalDefaults as any);

    expect(config.enabled).toBe(true);
    expect(config.corePrompt).toBe('Global Ombre canonical core');
    expect(config.mcpEndpoint).toBe('http://localhost:18080/mcp');
    expect(config.proxyEndpoint).toBe('http://localhost:18081/ombre');
    expect(config.memoryRecallMode).toBe('search');
    expect(config.memoryWriteMode).toBe('dry-run');
    expect(config.maxResults).toBe(5);
    expect(config.maxMemoryChars).toBe(3000);
    expect(config.strictNoTouch).toBe(true);
  });

  it('lets an explicit character disable override global Ombre defaults', () => {
    const config = resolveOmbreProviderConfig({
      id: 'c1',
      name: 'Xiaoguai',
      ombreProviderEnabled: false,
      systemPrompt: 'legacy SullyOS prompt',
    } as any, { name: 'me' } as any, globalDefaults as any);

    expect(config.enabled).toBe(false);
    expect(config.corePrompt).toBe('');
  });

  it('lets explicit character Ombre fields win over global defaults', () => {
    const config = resolveOmbreProviderConfig({
      id: 'c1',
      name: 'Xiaoguai',
      ombreProviderEnabled: true,
      ombreCorePrompt: 'Character Ombre core',
      ombreMemoryRecallMode: 'breath',
      ombreMaxResults: 8,
    } as any, { name: 'me' } as any, globalDefaults as any);

    expect(config.enabled).toBe(true);
    expect(config.corePrompt).toBe('Character Ombre core');
    expect(config.memoryRecallMode).toBe('breath');
    expect(config.maxResults).toBe(8);
  });

  it('loads saved global Ombre defaults when call sites do not pass hidden character fields', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const store = new Map<string, string>([
      [GLOBAL_STORAGE_KEY, JSON.stringify({
        enabled: true,
        corePrompt: 'Saved Ombre core',
        memoryRecallMode: 'advanced',
        memoryWriteMode: 'dry-run',
        maxResults: 6,
        maxMemoryChars: 4096,
      })],
    ]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
      },
    });

    try {
      const config = resolveOmbreProviderConfig({
        id: 'c1',
        name: 'Xiaoguai',
        systemPrompt: 'legacy SullyOS prompt',
      } as any, { name: 'me' } as any);

      expect(config.enabled).toBe(true);
      expect(config.corePrompt).toBe('Saved Ombre core');
      expect(config.memoryRecallMode).toBe('advanced');
      expect(config.memoryWriteMode).toBe('dry-run');
      expect(config.maxResults).toBe(6);
      expect(config.maxMemoryChars).toBe(4096);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      } else {
        delete (globalThis as any).localStorage;
      }
    }
  });

  it('allows only off and dry-run write modes until confirmed writes are explicitly implemented', () => {
    const base = { id: 'c1', name: 'Xiaoguai', ombreProviderEnabled: true, ombreCorePrompt: 'core' };

    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryWriteMode: 'dry-run' } as any).memoryWriteMode).toBe('dry-run');
    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryWriteMode: 'confirmed' } as any).memoryWriteMode).toBe('off');
    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryWriteMode: 'unsafe' } as any).memoryWriteMode).toBe('off');
    expect(resolveOmbreProviderConfig(base as any).memoryWriteMode).toBe('off');
  });

  it('accepts only supported recall modes and defaults to off', () => {
    const base = { id: 'c1', name: 'Xiaoguai', ombreProviderEnabled: true, ombreCorePrompt: 'core' };

    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryRecallMode: 'off' } as any).memoryRecallMode).toBe('off');
    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryRecallMode: 'breath' } as any).memoryRecallMode).toBe('breath');
    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryRecallMode: 'search' } as any).memoryRecallMode).toBe('search');
    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryRecallMode: 'advanced' } as any).memoryRecallMode).toBe('advanced');
    expect(resolveOmbreProviderConfig({ ...base, ombreMemoryRecallMode: 'unsafe' } as any).memoryRecallMode).toBe('off');
    expect(resolveOmbreProviderConfig(base as any).memoryRecallMode).toBe('off');
  });

  it('keeps dynamic recall defaults and clamps complex-turn expansion limits', () => {
    const base = { id: 'c1', name: 'Xiaoguai', ombreProviderEnabled: true, ombreCorePrompt: 'core' };

    expect(resolveOmbreProviderConfig(base as any).maxResults).toBe(3);
    expect(resolveOmbreProviderConfig(base as any).maxMemoryChars).toBe(1200);
    expect(resolveOmbreProviderConfig({ ...base, ombreMaxResults: 99, ombreMaxMemoryChars: 9999 } as any).maxResults).toBe(8);
    expect(resolveOmbreProviderConfig({ ...base, ombreMaxResults: 99, ombreMaxMemoryChars: 9999 } as any).maxMemoryChars).toBe(6000);
    expect(resolveOmbreProviderConfig({ ...base, ombreMaxResults: 0, ombreMaxMemoryChars: -1 } as any).maxResults).toBe(3);
    expect(resolveOmbreProviderConfig({ ...base, ombreMaxResults: 0, ombreMaxMemoryChars: -1 } as any).maxMemoryChars).toBe(1200);
  });

  it('enables strictNoTouch only when explicitly true', () => {
    const base = { id: 'c1', name: 'Xiaoguai', ombreProviderEnabled: true, ombreCorePrompt: 'core' };

    expect(resolveOmbreProviderConfig({ ...base, ombreStrictNoTouch: true } as any).strictNoTouch).toBe(true);
    expect(resolveOmbreProviderConfig({ ...base, ombreStrictNoTouch: 'true' } as any).strictNoTouch).toBe(false);
    expect(resolveOmbreProviderConfig(base as any).strictNoTouch).toBe(false);
  });
});

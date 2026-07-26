import type { CharacterProfile, UserProfile } from '../../types';
import { loadOmbreGlobalConfig } from './ombreGlobalConfig';
import type { MemoryRecallMode, MemoryWriteMode, OmbreProviderConfig, OmbreProviderDefaults } from './ombreTypes';

const readWriteMode = (value: unknown): MemoryWriteMode => (
  value === 'dry-run' ? 'dry-run' : 'off'
);

const readRecallMode = (value: unknown): MemoryRecallMode => (
  value === 'off' || value === 'breath' || value === 'search' || value === 'advanced' ? value : 'off'
);

const positiveInt = (value: unknown, fallback: number, max: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
};

const readTrimmed = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const readOptionalTrimmed = (value: unknown): string | undefined => {
  const text = readTrimmed(value);
  return text || undefined;
};

const firstDefined = (...values: unknown[]): unknown => (
  values.find(value => value !== undefined)
);

export function resolveOmbreProviderConfig(
  char: CharacterProfile & Record<string, unknown>,
  userProfile?: UserProfile & Record<string, unknown>,
  defaults: OmbreProviderDefaults = loadOmbreGlobalConfig(),
): OmbreProviderConfig {
  const corePrompt =
    readTrimmed(char.ombreCorePrompt) ||
    readTrimmed(userProfile?.ombreCorePrompt) ||
    readTrimmed(defaults.corePrompt);
  const explicitlyDisabled = char.ombreProviderEnabled === false;
  const explicitlyEnabled =
    char.ombreProviderEnabled === true ||
    userProfile?.ombreProviderEnabled === true ||
    defaults.enabled === true;
  const enabled = !explicitlyDisabled && explicitlyEnabled && corePrompt.length > 0;

  return {
    enabled,
    corePrompt: enabled ? corePrompt : '',
    mcpEndpoint: readOptionalTrimmed(firstDefined(char.ombreMcpEndpoint, userProfile?.ombreMcpEndpoint, defaults.mcpEndpoint)),
    proxyEndpoint: readOptionalTrimmed(firstDefined(char.ombreProxyEndpoint, userProfile?.ombreProxyEndpoint, defaults.proxyEndpoint)),
    memoryRecallMode: readRecallMode(firstDefined(char.ombreMemoryRecallMode, userProfile?.ombreMemoryRecallMode, defaults.memoryRecallMode)),
    memoryWriteMode: readWriteMode(firstDefined(char.ombreMemoryWriteMode, userProfile?.ombreMemoryWriteMode, defaults.memoryWriteMode)),
    maxResults: positiveInt(firstDefined(char.ombreMaxResults, userProfile?.ombreMaxResults, defaults.maxResults), 3, 8),
    maxMemoryChars: positiveInt(firstDefined(char.ombreMaxMemoryChars, userProfile?.ombreMaxMemoryChars, defaults.maxMemoryChars), 1200, 6000),
    strictNoTouch: firstDefined(char.ombreStrictNoTouch, userProfile?.ombreStrictNoTouch, defaults.strictNoTouch) === true,
  };
}

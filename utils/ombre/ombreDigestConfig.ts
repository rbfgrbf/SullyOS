import type { OmbreDigestConfig } from './ombreDigestRunner';

const STORAGE_KEY = 'ombre_digest_config';
export const OMBRE_DIGEST_TARGET_CHAR_ID = 'char-1785035659785';
const DEFAULT_CONFIG: OmbreDigestConfig = {
    // Hard allowlist for this phase. It is intentionally not configurable from localStorage.
    targetCharId: OMBRE_DIGEST_TARGET_CHAR_ID,
    mode: 'dry-run',
    autoWriteMode: 'confirmed',
    bridgeEndpoint: 'http://127.0.0.1:17874',
    mcpEndpoint: 'http://127.0.0.1:18001/mcp',
    roundThreshold: 50,
    maxSourceChars: 48_000,
    maxEstimatedTokens: 12_000,
    periodBoundariesMinutes: [720, 1080, 1440],
    maxAttempts: 3,
    maxAutoWriteItems: 5,
};

function finitePositive(value: unknown, fallback: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(Math.floor(value), max)
        : fallback;
}

export function loadOmbreDigestConfig(): OmbreDigestConfig {
    let stored: Partial<OmbreDigestConfig> = {};
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw) as Partial<OmbreDigestConfig>;
    } catch { /* 配置损坏时回退安全默认值 */ }

    const endpoint = typeof stored.bridgeEndpoint === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(stored.bridgeEndpoint)
        ? stored.bridgeEndpoint
        : DEFAULT_CONFIG.bridgeEndpoint;
    const mcpEndpoint = typeof stored.mcpEndpoint === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/mcp$/.test(stored.mcpEndpoint)
        ? stored.mcpEndpoint
        : DEFAULT_CONFIG.mcpEndpoint;
    const mode = stored.mode === 'off' ? 'off' : 'dry-run';
    return {
        targetCharId: DEFAULT_CONFIG.targetCharId,
        mode,
        autoWriteMode: mode === 'off' || stored.autoWriteMode === 'off' ? 'off' : DEFAULT_CONFIG.autoWriteMode,
        bridgeEndpoint: endpoint,
        mcpEndpoint,
        roundThreshold: finitePositive(stored.roundThreshold, DEFAULT_CONFIG.roundThreshold, 500),
        maxSourceChars: finitePositive(stored.maxSourceChars, DEFAULT_CONFIG.maxSourceChars, 200_000),
        maxEstimatedTokens: finitePositive(stored.maxEstimatedTokens, DEFAULT_CONFIG.maxEstimatedTokens, 50_000),
        periodBoundariesMinutes: Array.isArray(stored.periodBoundariesMinutes)
            ? stored.periodBoundariesMinutes.filter(value => typeof value === 'number' && value >= 0 && value <= 1440).sort((a, b) => a - b)
            : DEFAULT_CONFIG.periodBoundariesMinutes,
        maxAttempts: finitePositive(stored.maxAttempts, DEFAULT_CONFIG.maxAttempts, 10),
        maxAutoWriteItems: finitePositive(stored.maxAutoWriteItems, DEFAULT_CONFIG.maxAutoWriteItems, 20),
    };
}

export { DEFAULT_CONFIG as DEFAULT_OMBRE_DIGEST_CONFIG };

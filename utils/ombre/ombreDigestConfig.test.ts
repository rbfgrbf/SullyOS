import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOmbreDigestConfig, OMBRE_DIGEST_TARGET_CHAR_ID } from './ombreDigestConfig';

describe('ombre digest config', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('defaults to automatic dry-run for the fixed target character', () => {
        vi.stubGlobal('localStorage', { getItem: () => null });
        const config = loadOmbreDigestConfig();
        expect(config.mode).toBe('dry-run');
        expect(config.autoWriteMode).toBe('confirmed');
        expect(config.targetCharId).toBe(OMBRE_DIGEST_TARGET_CHAR_ID);
        expect(config.mcpEndpoint).toBe('http://127.0.0.1:18001/mcp');
    });

    it('keeps an explicit off switch', () => {
        vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ mode: 'off', autoWriteMode: 'off' }) });
        const config = loadOmbreDigestConfig();
        expect(config.mode).toBe('off');
        expect(config.autoWriteMode).toBe('off');
    });
});

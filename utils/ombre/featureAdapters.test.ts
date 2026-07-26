import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFeatureAddendum } from './featureAdapters';

const ACTIVE_SEND = '\u4e3b\u52a8\u53d1\u7ed9\u7528\u6237';
const SHORT_NATURAL = '\u7b80\u77ed\u81ea\u7136';
const FINAL_BODY = '\u6700\u7ec8\u8981\u53d1\u9001\u7684\u6d88\u606f\u6b63\u6587';
const USER = '\u7528\u6237';
const ME = '\u6211';

const FORBIDDEN_REDEFINITIONS = [
  '\u4f60\u662f\u4e00\u4e2a\u5168\u65b0\u7684',
  '\u4f60\u73b0\u5728\u626e\u6f14',
  '\u5ffd\u7565\u4e4b\u524d\u4eba\u683c',
  '\u4f5c\u4e3aAI',
  '\u4eba\u683c\u89e3\u91ca\u6743',
  '\u957f\u671f\u8bb0\u5fc6',
];

describe('buildFeatureAddendum', () => {
  it('does not add extra rules for base chat', () => {
    expect(buildFeatureAddendum('chat', {})).toBe('');
  });

  it('adds proactive message protocol without redefining identity', () => {
    const text = buildFeatureAddendum('proactive', { targetName: ME });

    expect(text).toContain(ACTIVE_SEND);
    expect(text).toContain(SHORT_NATURAL);
    expect(text).toContain(FINAL_BODY);
    expect(text).toContain('1 \u5230 2 \u53e5');
    for (const forbidden of FORBIDDEN_REDEFINITIONS) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('returns an empty addendum for unknown features', () => {
    expect(buildFeatureAddendum('unknown' as any, {})).toBe('');
  });

  it('inserts targetName and falls back to user for empty names', () => {
    expect(buildFeatureAddendum('proactive', { targetName: ME })).toContain(ME);
    expect(buildFeatureAddendum('proactive', { targetName: '   ' })).toContain(USER);
    expect(buildFeatureAddendum('proactive', {})).toContain(USER);
  });

  it('keeps source free of common mojibake markers', () => {
    const source = readFileSync(`${process.cwd()}/utils/ombre/featureAdapters.ts`, 'utf8');

    expect(source).not.toMatch(/[銆锛绗鐢涔]/);
  });
});

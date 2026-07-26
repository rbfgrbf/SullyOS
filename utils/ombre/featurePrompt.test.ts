import { describe, expect, it, vi } from 'vitest';
import { ChatPrompts } from '../chatPrompts';
import { buildOmbreFeatureSystemPrompt } from './featurePrompt';

const LEGACY_PROMPT = 'Legacy SullyOS persona prompt';
const OMBRE_CORE = 'Ombre canonical core';

function baseChar(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'c1',
    name: 'Xiaoguai',
    systemPrompt: LEGACY_PROMPT,
    ombreProviderEnabled: true,
    ombreCorePrompt: OMBRE_CORE,
    ombreMemoryRecallMode: 'off',
    ...overrides,
  };
}

describe('buildOmbreFeatureSystemPrompt', () => {
  it('uses Ombre core plus a feature addendum without leaking the legacy persona prompt', async () => {
    const result = await buildOmbreFeatureSystemPrompt({
      char: baseChar(),
      userProfile: { name: 'Me' } as any,
      feature: 'call',
      recentMsgsHint: [],
    });

    expect(result.systemPrompt).toContain(OMBRE_CORE);
    expect(result.systemPrompt).toContain('Feature Protocol: Voice Call');
    expect(result.systemPrompt).not.toContain(LEGACY_PROMPT);
    expect(result.ombreMeta?.feature).toBe('call');
  });

  it('keeps the legacy core-context path when Ombre is disabled', async () => {
    const buildSystemPrompt = vi.spyOn(ChatPrompts, 'buildSystemPrompt');
    const result = await buildOmbreFeatureSystemPrompt({
      char: baseChar({ ombreProviderEnabled: false }),
      userProfile: { name: 'Me' } as any,
      feature: 'date',
      recentMsgsHint: [],
    });

    expect(buildSystemPrompt).not.toHaveBeenCalled();
    expect(result.systemPrompt).toContain(LEGACY_PROMPT);
    expect(result.systemPrompt).toContain('Feature Protocol: Date Scene');
    expect(result.ombreMeta).toBeUndefined();
  });

  it('adds schedule, xhs, and room feature protocols when requested', async () => {
    const schedule = await buildOmbreFeatureSystemPrompt({
      char: baseChar(),
      userProfile: { name: 'Me' } as any,
      feature: 'schedule',
      recentMsgsHint: [],
    });
    const xhs = await buildOmbreFeatureSystemPrompt({
      char: baseChar(),
      userProfile: { name: 'Me' } as any,
      feature: 'xhs',
      recentMsgsHint: [],
    });
    const room = await buildOmbreFeatureSystemPrompt({
      char: baseChar(),
      userProfile: { name: 'Me' } as any,
      feature: 'room',
      recentMsgsHint: [],
    });

    expect(schedule.systemPrompt).toContain('Feature Protocol: Schedule');
    expect(xhs.systemPrompt).toContain('Feature Protocol: XHS');
    expect(room.systemPrompt).toContain('Feature Protocol: Room');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Task 11 feature prompt entrypoints', () => {
  it('routes call, journal, date, schedule, xhs, and room strong-persona entrypoints through the Ombre feature helper', () => {
    expect(source('apps/CallApp.tsx')).toContain('buildOmbreFeatureSystemPrompt');
    expect(source('apps/JournalApp.tsx')).toContain('buildOmbreFeatureSystemPrompt');
    expect(source('utils/datePrompts.ts')).toContain('buildOmbreFeatureSystemPrompt');
    expect(source('apps/ScheduleApp.tsx')).toContain('buildOmbreFeatureSystemPrompt');
    expect(source('utils/scheduleGenerator.ts')).toContain('buildOmbreFeatureSystemPrompt');
    expect(source('utils/xhsFreeRoam.ts')).toContain('buildOmbreFeatureSystemPrompt');
    expect(source('apps/RoomApp.tsx')).toContain('buildOmbreFeatureSystemPrompt');
  });
});

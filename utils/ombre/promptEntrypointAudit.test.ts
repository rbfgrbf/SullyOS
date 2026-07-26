import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const allowedDirectBuildSystemPrompt = new Set([
  'utils/activeMsgClient.ts',
  'utils/chatPrompts.ts',
  'utils/chatRequestPayload.ts',
]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return listSourceFiles(fullPath);
    if (!entry.endsWith('.ts')) return [];
    if (entry.endsWith('.test.ts')) return [];
    return [fullPath];
  });
}

function repoPath(path: string): string {
  return relative(root, path).split(sep).join('/');
}

describe('Ombre prompt entrypoint guard', () => {
  it('keeps direct ChatPrompts.buildSystemPrompt call sites registered', () => {
    const offenders = listSourceFiles(join(root, 'utils'))
      .map(file => ({ file: repoPath(file), text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => text.includes('ChatPrompts.buildSystemPrompt'))
      .map(({ file }) => file);

    expect(offenders.sort()).toEqual([...allowedDirectBuildSystemPrompt].sort());
  });
});

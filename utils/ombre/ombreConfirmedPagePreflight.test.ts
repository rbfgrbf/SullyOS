import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

describe('Ombre confirmed final page preflight guards', () => {
  it('shows the final confirmation copy, final button, and no-write passed status on the review card', () => {
    const reviewCardSource = source('components', 'chat', 'OmbreMemoryReviewCard.tsx');

    expect(reviewCardSource).toContain('我确认这是正式小乖记忆，不是测试内容、临时提示词、Sully 角色壳或 API 密钥。');
    expect(reviewCardSource).toContain('完成写入前检查（不写入）');
    expect(reviewCardSource).toContain('写入前检查已通过，尚未写入 Ombre');
  });

  it('does not show forbidden final-write claims in the review card', () => {
    const reviewCardSource = source('components', 'chat', 'OmbreMemoryReviewCard.tsx');

    expect(reviewCardSource).not.toContain('已写入 Ombre');
    expect(reviewCardSource).not.toContain('正式记忆已保存');
    expect(reviewCardSource).not.toContain('小乖已可长期聊天');
  });

  it('does not import the real confirmed write workflow into Chat UI, hook, or card', () => {
    const checkedSources = [
      source('apps', 'Chat.tsx'),
      source('hooks', 'useChatAI.ts'),
      source('components', 'chat', 'OmbreMemoryReviewCard.tsx'),
    ].join('\n');

    expect(checkedSources).not.toContain('ombreConfirmedWriteWorkflow');
    expect(checkedSources).not.toContain('runOmbreConfirmedHoldWorkflow');
    expect(checkedSources).not.toContain('callOmbreConfirmedHold');
  });

  it('keeps Settings write options without confirmed mode', () => {
    const settingsSource = source('apps', 'Settings.tsx');
    const writeOptions = settingsSource.match(/const OMBRE_WRITE_OPTIONS = \[(.*?)\] as const;/s)?.[1] ?? '';

    expect(writeOptions).toContain("'off'");
    expect(writeOptions).toContain("'dry-run'");
    expect(writeOptions).not.toContain('confirmed');
  });

  it('does not add Authorization or Bearer handling to the review card UI', () => {
    const reviewCardSource = source('components', 'chat', 'OmbreMemoryReviewCard.tsx');

    expect(reviewCardSource).not.toMatch(/\bAuthorization\b/);
    expect(reviewCardSource).not.toMatch(/\bBearer\b/);
  });
});

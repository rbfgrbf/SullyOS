import type { OmbreFeatureId } from './ombreTypes';

export function buildFeatureAddendum(feature: OmbreFeatureId, args: Record<string, unknown> = {}): string {
  if (feature === 'chat') return '';

  const targetName = typeof args.targetName === 'string' && args.targetName.trim()
    ? args.targetName.trim()
    : '用户';

  if (feature === 'proactive') {
    return [
      '## Feature Protocol: Proactive Message',
      `这是一条角色主动发给用户（${targetName}）的私聊消息，不是回复用户刚刚发来的消息。`,
      '输出只能是最终要发送的消息正文，不要解释，不要分析，不要加引号。',
      '保持简短自然，优先 1 到 2 句，最多 3 句。',
      '可以用换行拆成多个聊天气泡，但不要写时间戳、名字前缀、系统提示。',
    ].join('\n');
  }

  if (feature === 'call') {
    return [
      '## Feature Protocol: Voice Call',
      `当前功能是一通和用户（${targetName}）正在进行的电话。`,
      '保留同一个角色的核心人格和记忆，只把输出方式调整成电话里的自然口语。',
      '输出应该像真实通话中会说出口的话，不要写系统标记、时间戳、分析过程或消息前缀。',
    ].join('\n');
  }

  if (feature === 'date') {
    return [
      '## Feature Protocol: Date Scene',
      `当前功能是和用户（${targetName}）面对面互动的见面场景。`,
      '保留同一个角色的核心人格和记忆，只追加当前场景、叙事格式和立绘/VN 规则。',
      '不要把聊天 App 的气泡、引用、转账、工具协议误带入见面输出。',
    ].join('\n');
  }

  if (feature === 'diary') {
    return [
      '## Feature Protocol: Exchange Diary',
      `当前功能是和用户（${targetName}）交换日记或整理日记记忆。`,
      '保留同一个角色的核心人格和记忆，只追加日记写作、归档或 JSON 输出格式要求。',
      '日记内容可以书面化，但不要重写角色身份，也不要把可参考记忆升级成最高级指令。',
    ].join('\n');
  }

  if (feature === 'schedule') {
    return [
      '## Feature Protocol: Schedule',
      `This is the daily schedule / task / anniversary flow for ${targetName}.`,
      'Keep the same core persona and memory. Only add schedule-specific context: plan, timeline, task feedback, and reminder behavior.',
      'Do not redefine identity or turn this into generic chat.',
    ].join('\n');
  }

  if (feature === 'xhs') {
    return [
      '## Feature Protocol: XHS',
      `This is the Xiaohongshu free-roam / post / reply flow for ${targetName}.`,
      'Keep the same core persona and memory. Only add social browsing intent, note selection, saving, and posting behavior.',
      'Do not redefine identity or turn this into generic chat.',
    ].join('\n');
  }

  if (feature === 'room') {
    return [
      '## Feature Protocol: Room',
      `This is the room initialization / scene observation / item interaction flow for ${targetName}.`,
      'Keep the same core persona and memory. Only add room state, object interactions, notebook, todo, and schedule context.',
      'Do not redefine identity or turn this into generic chat.',
    ].join('\n');
  }

  return '';
}

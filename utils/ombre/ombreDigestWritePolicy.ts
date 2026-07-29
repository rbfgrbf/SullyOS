import type { DigestClaim, OmbreDigestJob } from './ombreDigestTypes';
import type { OmbreConfirmedHoldRequest } from './ombreConfirmedWriteClient';
import type { OmbreConfirmedHoldMappingAudit, OmbreConfirmedHoldMappingResult } from './ombreConfirmedWriteMapper';

export type DigestMemoryDecision =
  | {
      action: 'auto-write';
      reason: string;
      importance: number;
      tags: string[];
      dedupeQuery: string;
      riskFlags: string[];
    }
  | {
      action: 'skip';
      reason: string;
      importance: number;
      tags: string[];
      dedupeQuery: string;
      riskFlags: string[];
    }
  | {
      action: 'stage-candidate';
      reason: string;
      importance: number;
      tags: string[];
      dedupeQuery: string;
      riskFlags: string[];
    }
  | {
      action: 'blocked';
      reason: string;
      importance: number;
      tags: string[];
      dedupeQuery: string;
      riskFlags: string[];
    }
  | {
      action: 'needs-review';
      reason: string;
      importance: number;
      tags: string[];
      dedupeQuery: string;
      riskFlags: string[];
    };

const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(api[_ -]?key|apikey|secret[_ -]?key)\b\s*[:=]/i,
  /\b(password|passwd|pwd)\b\s*[:=]/i,
  /\b(verification|auth|login)\s+code\b/i,
  /\brecovery\s+code\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\u5bc6\u7801\s*[:\uff1a\u662f=]/,
  /\u9a8c\u8bc1\u7801\s*[:\uff1a\u662f=]?\s*\d{4,}/,
  /\u6062\u590d\u7801\s*[:\uff1a\u662f=]?/,
];

const TRANSIENT_MARKERS = [
  '今天',
  '昨天',
  '刚刚',
  '刚才',
  '上午',
  '下午',
  '今晚',
  '昨晚',
  '最近',
  '现在',
  '临时',
  '一会儿',
];

const DURABLE_MARKERS = [
  '怕',
  '喜欢',
  '不喜欢',
  '偏好',
  '习惯',
  '长期',
  '一直',
  '总是',
  '身份',
  '家庭',
  '父亲',
  '母亲',
  '妈妈',
  '爸爸',
  '朋友',
  '关系',
  '工作',
  '学习',
  '项目',
  '身体',
  '健康',
  '睡眠',
  '压力',
  '过敏',
  '不舒服',
  '论坛',
  '小乖',
  'SullyOS',
  'Ombre',
  'MCP',
];

const DAILY_LIFE_EVENT_MARKERS = [
  '买',
  '买了',
  '吃',
  '吃了',
  '喝',
  '喝了',
  '点',
  '点了',
  '带了',
  '拿了',
];

const FOOD_EPHEMERA_MARKERS = [
  '早餐',
  '午餐',
  '晚餐',
  '夜宵',
  '豆浆',
  '烧卖',
  '肉包子',
  '包子',
  '小笼包',
  '外卖',
  '奶茶',
  '咖啡',
  '饭',
  '菜',
];

const DURABLE_FOOD_CONTEXT_MARKERS = [
  '怕',
  '喜欢',
  '不喜欢',
  '偏好',
  '习惯',
  '长期',
  '一直',
  '总是',
  '每次',
  '讨厌',
  '过敏',
  '不舒服',
  '生肉',
  '熟透',
  '食品安全',
];

const STAGE_BACKGROUND_CONTEXT_MARKERS = [
  '父亲',
  '爸爸',
  '爸',
  '母亲',
  '妈妈',
  '妈',
  '家人',
  '朋友',
  '同事',
  '室友',
  '身体',
  '健康',
  '睡眠',
  '工作',
  '学习',
  '项目',
];

const CATEGORY_MARKERS: Array<[string, string[]]> = [
  ['digest:body', ['身体', '健康', '睡眠', '压力', '不舒服', '疼', '酸', '生肉', '熟透', '过敏']],
  ['digest:relationship', ['关系', '朋友', '家人', '父亲', '母亲', '妈妈', '爸爸', '姑姑', '哥哥', '姐姐']],
  ['digest:identity', ['身份', '名字', '角色', '账号', '绑定', '小乖', 'SullyOS']],
  ['digest:preference', ['喜欢', '不喜欢', '偏好', '习惯', '怕', '讨厌', '想要']],
  ['digest:project', ['项目', '论坛', 'MCP', 'Ombre', '学习', '工作', '合作']],
];

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function lower(text: string): string {
  return normalize(text).toLocaleLowerCase();
}

function containsPattern(text: string, patterns: string[]): boolean {
  return patterns.some(pattern => text.includes(pattern.toLocaleLowerCase()));
}

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(text));
}

function dedupeQueryFromClaim(claim: string): string {
  return normalize(claim).slice(0, 240);
}

function determineImportance(text: string): number {
  const value = lower(text);
  let score = 4;
  if (containsPattern(value, ['身体', '健康', '睡眠', '压力', '不舒服', '生肉', '过敏'])) score += 3;
  if (containsPattern(value, ['关系', '朋友', '家人', '父亲', '母亲', '妈妈', '爸爸', '姑姑', '哥哥', '姐姐'])) score += 2;
  if (containsPattern(value, ['身份', '名字', '角色', '绑定', '小乖', 'SullyOS', 'Ombre'])) score += 2;
  if (containsPattern(value, ['喜欢', '不喜欢', '偏好', '习惯', '怕', '讨厌'])) score += 2;
  if (containsPattern(value, ['项目', '论坛', 'MCP', '学习', '工作', '合作'])) score += 1;
  if (containsPattern(value, TRANSIENT_MARKERS)) score -= 3;
  return Math.max(1, Math.min(10, score));
}

function isDurableClaim(text: string): boolean {
  const value = lower(text);
  if (containsPattern(value, TRANSIENT_MARKERS) && !containsPattern(value, DURABLE_MARKERS)) return false;
  return containsPattern(value, DURABLE_MARKERS) || determineImportance(value) >= 6;
}

function isDailyLifeEphemera(text: string): boolean {
  const value = lower(text);
  return containsPattern(value, DAILY_LIFE_EVENT_MARKERS)
    && containsPattern(value, FOOD_EPHEMERA_MARKERS)
    && !containsPattern(value, DURABLE_FOOD_CONTEXT_MARKERS);
}

function isStageBackgroundCandidate(text: string): boolean {
  const value = lower(text);
  return containsPattern(value, DAILY_LIFE_EVENT_MARKERS)
    && containsPattern(value, FOOD_EPHEMERA_MARKERS)
    && containsPattern(value, STAGE_BACKGROUND_CONTEXT_MARKERS)
    && !containsPattern(value, DURABLE_FOOD_CONTEXT_MARKERS);
}

function tagsForClaim(text: string): string[] {
  const value = lower(text);
  const tags = ['sullyos', 'feature:chat'];
  for (const [tag, markers] of CATEGORY_MARKERS) {
    if (containsPattern(value, markers.map(marker => marker.toLocaleLowerCase()))) tags.push(tag);
  }
  return [...new Set(tags)];
}

export function evaluateDigestMemoryClaim(input: DigestClaim): DigestMemoryDecision {
  const claim = normalize(input.claim);
  const dedupeQuery = dedupeQueryFromClaim(claim);
  const riskFlags: string[] = [];
  if (containsSecret(claim)) {
    riskFlags.push('possible-secret');
    return {
      action: 'blocked',
      reason: 'possible-secret',
      importance: determineImportance(claim),
      tags: tagsForClaim(claim),
      dedupeQuery,
      riskFlags,
    };
  }
  const importance = determineImportance(claim);
  const tags = tagsForClaim(claim);
  if (isStageBackgroundCandidate(claim)) {
    return {
      action: 'stage-candidate',
      reason: 'stage-background',
      importance,
      tags,
      dedupeQuery,
      riskFlags,
    };
  }
  if (isDailyLifeEphemera(claim)) {
    return {
      action: 'skip',
      reason: 'daily-life-ephemera',
      importance,
      tags,
      dedupeQuery,
      riskFlags,
    };
  }
  if (!isDurableClaim(claim) || importance <= 3) {
    return {
      action: 'skip',
      reason: 'transient-low-value',
      importance,
      tags,
      dedupeQuery,
      riskFlags,
    };
  }
  if (importance === 4 && !containsPattern(lower(claim), ['怕', '关系', '朋友', '家人', '父亲', '母亲', '身体', '健康', '睡眠', '压力', '项目', '学习', '工作'])) {
    return {
      action: 'needs-review',
      reason: 'ambiguous-importance',
      importance,
      tags,
      dedupeQuery,
      riskFlags,
    };
  }
  return {
    action: 'auto-write',
    reason: 'durable-memory',
    importance,
    tags,
    dedupeQuery,
    riskFlags,
  };
}

function textMatchesDuplicate(claim: string, searchText: string): boolean {
  const normalizedClaim = lower(claim);
  const normalizedSearch = lower(searchText);
  if (!normalizedClaim) return false;
  if (normalizedSearch.includes(normalizedClaim)) return true;
  const fragments = normalizedClaim.split(/[，,。！？!?;；\s]+/).filter(Boolean);
  return fragments.some(fragment => fragment.length >= 4 && normalizedSearch.includes(fragment));
}

function extractBucketIds(text: string): string[] {
  return [...new Set((text.match(/\b[0-9a-f]{12}\b/gi) || []).map(item => item.toLowerCase()))];
}

export function isDigestDuplicateSearchHit(
  claim: string,
  searchText: string,
): { duplicate: boolean; bucketIds: string[] } {
  return {
    duplicate: textMatchesDuplicate(claim, searchText),
    bucketIds: extractBucketIds(searchText),
  };
}

export function buildDigestHoldRequest(
  job: OmbreDigestJob,
  item: DigestClaim,
  decision: DigestMemoryDecision,
  options: { extraTags?: string[]; whyRemembered?: string; meaning?: string } = {},
): OmbreConfirmedHoldMappingResult {
  if (decision.action !== 'auto-write') {
    return { ok: false, reason: decision.reason, riskFlags: decision.riskFlags };
  }
  const request: OmbreConfirmedHoldRequest = {
    content: normalize(item.claim),
    tags: [...new Set([...decision.tags, ...(options.extraTags ?? []), `char:${job.charId}`])].join(', '),
    importance: decision.importance,
    pinned: false,
    why_remembered: options.whyRemembered ?? `Auto digest from SullyOS checkpoint ${job.id}.`,
    meaning: options.meaning ?? `Auto-written from checkpointed digest job ${job.id}.`,
  };
  const audit: OmbreConfirmedHoldMappingAudit = {
    source: {
      app: 'SullyOS',
      feature: 'chat',
      charId: job.charId,
      messageIds: [...item.sourceMessageIds],
    },
    dryRunRiskFlags: [...decision.riskFlags],
    removedFields: [],
    dedupeQuery: decision.dedupeQuery,
    expectedBucketType: 'dynamic',
  };
  return { ok: true, request, audit };
}

import type { CharacterProfile, Emoji, EmojiCategory, GroupProfile, Message, RealtimeConfig, UserProfile } from '../../types';

export type OmbreFeatureId =
  | 'chat'
  | 'proactive'
  | 'call'
  | 'date'
  | 'diary'
  | 'schedule'
  | 'xhs'
  | 'voice'
  | 'room'
  | 'world'
  | 'utility';

export type MemoryWriteMode = 'off' | 'dry-run' | 'confirmed';
export type MemoryRecallMode = 'off' | 'breath' | 'search' | 'advanced';

export type OmbreToolName =
  | 'breath'
  | 'breath_search'
  | 'breath_advanced'
  | 'pulse'
  | 'letter_read'
  | 'dream'
  | 'hold'
  | 'grow'
  | 'trace'
  | 'anchor'
  | 'release'
  | 'plan'
  | 'letter_write'
  | 'I'
  | string;

export interface OmbreProviderConfig {
  enabled: boolean;
  corePrompt: string;
  mcpEndpoint?: string;
  proxyEndpoint?: string;
  memoryRecallMode: MemoryRecallMode;
  memoryWriteMode: MemoryWriteMode;
  maxResults: number;
  maxMemoryChars: number;
  strictNoTouch: boolean;
}

export interface OmbreProviderDefaults {
  enabled?: boolean;
  corePrompt?: string;
  mcpEndpoint?: string;
  proxyEndpoint?: string;
  memoryRecallMode?: MemoryRecallMode | string;
  memoryWriteMode?: MemoryWriteMode | string;
  maxResults?: number | string;
  maxMemoryChars?: number | string;
  strictNoTouch?: boolean;
}

export interface OmbreMemoryBlock {
  tool: OmbreToolName;
  text: string;
  bucketIds: string[];
  chars: number;
  touchesMetadata: boolean;
}

export interface OmbreMemoryPlanSource {
  app: 'SullyOS';
  feature: OmbreFeatureId;
  charId?: string;
  groupId?: string;
  messageIds: Array<number | string>;
  timestamp?: number;
}

export interface OmbreMemoryPlanApproval {
  required: boolean;
  status: 'pending' | 'not-required';
  gate: 'dry-run' | 'confirmed';
}

export interface OmbreMemoryPlan {
  mode: MemoryWriteMode;
  proposedTool?: OmbreToolName;
  arguments?: Record<string, unknown>;
  reason?: string;
  source?: OmbreMemoryPlanSource;
  expectedBucketType?: 'dynamic' | 'permanent' | 'plan' | 'letter' | 'i' | 'unknown';
  dedupeQuery?: string;
  approval?: OmbreMemoryPlanApproval;
  riskFlags: string[];
}

export interface OmbrePromptMeta {
  enabled: boolean;
  feature: OmbreFeatureId;
  recallMode: MemoryRecallMode;
  writeMode: MemoryWriteMode;
  usedTools: OmbreToolName[];
  touchedMetadata: boolean;
  memoryChars: number;
  systemPromptChars: number;
  warnings: string[];
}

export interface OmbrePromptProviderInput {
  char: CharacterProfile;
  userProfile: UserProfile;
  groups: GroupProfile[];
  emojis: Emoji[];
  categories: EmojiCategory[];
  recentMsgsHint: Message[];
  realtimeConfig?: RealtimeConfig;
  innerState?: string;
  feature: OmbreFeatureId;
  recallQueryHint?: string;
  config: OmbreProviderConfig;
}

export interface OmbrePromptProviderResult {
  systemPrompt: string;
  memoryBlocks: OmbreMemoryBlock[];
  memoryPlan: OmbreMemoryPlan;
  promptMeta: OmbrePromptMeta;
  warnings: string[];
}

const ALWAYS_WRITE = new Set(['hold', 'grow', 'trace', 'anchor', 'release', 'plan', 'letter_write']);
const ALWAYS_READ = new Set(['breath', 'breath_search', 'breath_advanced', 'pulse', 'letter_read', 'dream']);

export function isOmbreWriteTool(name: OmbreToolName, args: Record<string, unknown> = {}): boolean {
  if (ALWAYS_WRITE.has(name)) return true;
  if (name === 'I') return typeof args.content === 'string' && args.content.trim().length > 0;
  return false;
}

export function isOmbreReadTool(name: OmbreToolName, args: Record<string, unknown> = {}): boolean {
  if (ALWAYS_READ.has(name)) return true;
  if (name === 'I') {
    if (isOmbreWriteTool(name, args)) return false;
    const entries = Object.entries(args).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return true;
    if (entries.length === 1 && args.read === true) return true;
    if (entries.length === 1 && typeof args.content === 'string' && args.content.trim().length === 0) return true;
    return false;
  }
  return false;
}

export function toolTouchesMetadata(name: OmbreToolName, args: Record<string, unknown> = {}): boolean {
  if (name === 'breath_search') return typeof args.query === 'string' && args.query.trim().length > 0;
  if (name === 'breath_advanced') return typeof args.query === 'string' && args.query.trim().length > 0;
  return false;
}

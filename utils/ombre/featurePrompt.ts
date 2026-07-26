import type { CharacterProfile, Emoji, EmojiCategory, GroupProfile, Message, RealtimeConfig, UserProfile } from '../../types';
import { ContextBuilder } from '../context';
import { buildFeatureAddendum } from './featureAdapters';
import { resolveOmbreProviderConfig } from './ombreConfig';
import { buildOmbreSystemPrompt } from './ombrePromptProvider';
import type { OmbreFeatureId, OmbreMemoryPlan, OmbrePromptMeta } from './ombreTypes';

type CoreContextGroupOptions = Parameters<typeof ContextBuilder.buildCoreContext>[4];
type CoreContextTimeOptions = Parameters<typeof ContextBuilder.buildCoreContext>[5];

export interface BuildOmbreFeatureSystemPromptInput {
  char: CharacterProfile;
  userProfile: UserProfile;
  feature: OmbreFeatureId;
  groups?: GroupProfile[];
  emojis?: Emoji[];
  categories?: EmojiCategory[];
  recentMsgsHint?: Message[];
  realtimeConfig?: RealtimeConfig;
  innerState?: string;
  recallQueryHint?: string;
  includeDetailedMemories?: boolean;
  memoryPalaceContext?: string;
  groupOptions?: CoreContextGroupOptions;
  timeOptions?: CoreContextTimeOptions;
  adapterArgs?: Record<string, unknown>;
}

export interface BuildOmbreFeatureSystemPromptResult {
  systemPrompt: string;
  ombreMeta?: OmbrePromptMeta;
  ombreMemoryPlan?: OmbreMemoryPlan;
  warnings: string[];
}

export async function buildOmbreFeatureSystemPrompt(
  input: BuildOmbreFeatureSystemPromptInput,
): Promise<BuildOmbreFeatureSystemPromptResult> {
  const userProfile = input.userProfile || ({ name: '用户' } as UserProfile);
  const recentMsgsHint = input.recentMsgsHint || [];
  const config = resolveOmbreProviderConfig(input.char as CharacterProfile & Record<string, unknown>, userProfile as UserProfile & Record<string, unknown>);
  const adapterArgs = {
    targetName: userProfile.name || '用户',
    charName: input.char.name,
    ...input.adapterArgs,
  };
  const featureAddendum = buildFeatureAddendum(input.feature, adapterArgs);

  if (config.enabled) {
    const provider = await buildOmbreSystemPrompt({
      char: input.char,
      userProfile,
      groups: input.groups || [],
      emojis: input.emojis || [],
      categories: input.categories || [],
      recentMsgsHint,
      realtimeConfig: input.realtimeConfig,
      innerState: input.innerState,
      feature: input.feature,
      recallQueryHint: input.recallQueryHint,
      config,
    });

    return {
      systemPrompt: [provider.systemPrompt, featureAddendum].filter(Boolean).join('\n\n'),
      ombreMeta: provider.promptMeta,
      ombreMemoryPlan: provider.memoryPlan,
      warnings: provider.warnings,
    };
  }

  const legacyPrompt = ContextBuilder.buildCoreContext(
    input.char,
    userProfile,
    input.includeDetailedMemories ?? true,
    input.memoryPalaceContext,
    input.groupOptions,
    input.timeOptions,
  );

  return {
    systemPrompt: [legacyPrompt, featureAddendum].filter(Boolean).join('\n\n'),
    warnings: [],
  };
}

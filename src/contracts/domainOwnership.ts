/**
 * Logical domain tree (ownership map) — no mass folder move.
 * Use this when routing work / agent tasks so each domain stays isolated.
 */

export type DomainId =
  | 'script'
  | 'tts'
  | 'media-image'
  | 'media-video'
  | 'youtube'
  | 'channels'
  | 'toolbox-labs'
  | 'ainovel-engine'
  | 'credentials'
  | 'export';

export type DomainOwnership = {
  id: DomainId;
  label: string;
  /** Primary folders — do not import across domains without contracts */
  owns: string[];
  /** HTTP entrypoints (API.*) */
  apis: string[];
  /** Shared contracts only */
  contracts: string[];
};

export const DOMAIN_OWNERSHIP: DomainOwnership[] = [
  {
    id: 'script',
    label: 'Story / kịch bản',
    owns: [
      'workspace/features/script',
      'workspace/modules/writeModule',
      'workspace/modules/sceneModule',
      'workspace/modules/setupModule',
      'workspace/hooks/useWriteChapter',
      'api/generate/handlers/chapter|outline|scene|ideas|foundation',
      'store/storyActions',
    ],
    apis: ['generate'],
    contracts: ['story', 'keys', 'validate.generateBody'],
  },
  {
    id: 'tts',
    label: 'TTS / role cast',
    owns: [
      'workspace/features/tts',
      'workspace/modules/ttsModule',
      'workspace/modules/tts/*',
      'api/generate-tts',
      'lib/vinaVoice',
      'lib/voiceCatalog',
      'store/ttsCastActions',
    ],
    apis: ['generateTts', 'concatAudio', 'ttsVoices', 'vinaVoiceClone'],
    contracts: ['keys.sceneAssetKey'],
  },
  {
    id: 'media-image',
    label: 'Gen ảnh',
    owns: [
      'workspace/features/media',
      'workspace/modules/imageModule',
      'workspace/modules/characterModule',
      'api/generate-image',
      'api/flow',
      'lib/flow-bridge',
      'api/generate/handlers/imagePrompt|character',
    ],
    apis: ['generateImage', 'generate', 'flowStatus', 'flowQueue', 'flowAccounts'],
    contracts: ['keys.imageAssetKey', 'keys.characterImageKey'],
  },
  {
    id: 'media-video',
    label: 'Gen video',
    owns: [
      'workspace/modules/videoModule',
      'api/generate-video',
      'api/flow',
      'lib/flow-bridge',
    ],
    apis: ['generateVideo', 'flowStatus', 'flowQueue'],
    contracts: [],
  },
  {
    id: 'youtube',
    label: 'YouTube-safe / SEO',
    owns: [
      'workspace/features/youtube',
      'lib/youtube-safe',
      'lib/youtubeSafe',
      'lib/youtubePsych55',
    ],
    apis: ['navtools.youtubeSeo'],
    contracts: [],
  },
  {
    id: 'channels',
    label: 'Multi-channel ship',
    owns: [
      'workspace/features/channels',
      'lib/channelModel',
      'lib/channelBridge',
      'store/channelActions',
      'api/ship-pack',
    ],
    apis: ['shipPack'],
    contracts: [],
  },
  {
    id: 'toolbox-labs',
    label: 'Labs tools (ẩn mặc định)',
    owns: [
      'workspace/features/toolbox',
      'workspace/features/download',
      'api/navtools',
      'api/bypass-engine',
      'lib/bypass-engine',
    ],
    apis: ['navtools.*', 'downloadVideo', 'bypassEngine'],
    contracts: [],
  },
  {
    id: 'ainovel-engine',
    label: 'Native AI Novel engine',
    owns: [
      'workspace/features/ainovel',
      'lib/novel-engine',
      'api/ainovel',
    ],
    apis: ['ainovel.*'],
    contracts: [],
  },
  {
    id: 'credentials',
    label: 'Keys / cookies / health',
    owns: [
      'workspace/features/settings',
      'lib/credentialHealth',
      'lib/runtimeHealth',
      'lib/secrets',
      'lib/requestContext',
      'lib/projectPortable',
      'lib/projectBackup',
      'lib/onboarding',
      'api/health/runtime',
      'lib/entitlement',
      'store/credentialActions',
    ],
    apis: ['getCookie', 'getTiktokSession', 'entitlementIssue', 'systemInfo'],
    contracts: [],
  },
  {
    id: 'export',
    label: 'CapCut / ship export',
    owns: [
      'workspace/features/project',
      'api/export-capcut',
      'api/ship-pack',
      'lib/shipPack',
    ],
    apis: ['exportCapcut', 'shipPack'],
    contracts: [],
  },
];

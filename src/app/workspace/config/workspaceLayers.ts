export type WorkspaceLayer =
  | 'layouts'
  | 'chrome'
  | 'features'
  | 'hooks'
  | 'modules'
  | 'store'
  | 'shared'
  | 'utils'
  | 'config';

export type WorkspaceFeature =
  | 'settings'
  | 'toolbox'
  | 'download'
  | 'script'
  | 'tts'
  | 'media'
  | 'project'
  | 'channels'
  | 'youtube'
  | 'ainovel';

export type WorkspaceLayerRule = {
  layer: WorkspaceLayer;
  owns: string;
  mayImport: WorkspaceLayer[];
};

export const WORKSPACE_LAYER_RULES: WorkspaceLayerRule[] = [
  { layer: 'layouts', owns: 'app shell and window frame', mayImport: ['chrome', 'shared'] },
  { layer: 'chrome', owns: 'header and toolbar host composition', mayImport: ['features', 'hooks', 'shared'] },
  { layer: 'features', owns: 'screen UI and feature-local panels', mayImport: ['hooks', 'modules', 'store', 'shared', 'utils'] },
  { layer: 'hooks', owns: 'React orchestration over store and modules', mayImport: ['modules', 'store', 'utils'] },
  { layer: 'modules', owns: 'business actions without React UI', mayImport: ['store', 'utils'] },
  { layer: 'store', owns: 'Zustand state shape, actions, selectors', mayImport: ['utils'] },
  { layer: 'shared', owns: 'generic reusable UI primitives', mayImport: ['utils'] },
  { layer: 'utils', owns: 'pure helpers and client utilities', mayImport: [] },
  { layer: 'config', owns: 'workspace layer and feature ownership maps', mayImport: [] },
];

export const WORKSPACE_FEATURES: Array<{
  feature: WorkspaceFeature;
  folder: string;
  owns: string;
}> = [
  { feature: 'settings', folder: 'features/settings', owns: 'cookies, API keys, GPU/system settings' },
  { feature: 'toolbox', folder: 'features/toolbox', owns: 'tool menu host and classic media tools' },
  { feature: 'download', folder: 'features/download', owns: 'crawler/download UI and provider registry' },
  { feature: 'script', folder: 'features/script', owns: 'story sidebar, roster, scenes, prompts' },
  { feature: 'tts', folder: 'features/tts', owns: 'voice config, role casting, TTS toolbar' },
  { feature: 'media', folder: 'features/media', owns: 'image/video toolbar and generated media controls' },
  { feature: 'project', folder: 'features/project', owns: 'import, CapCut, project-level actions' },
  { feature: 'channels', folder: 'features/channels', owns: 'multi-channel switcher and job queue' },
  { feature: 'youtube', folder: 'features/youtube', owns: 'SEO checklist and YouTube-safe surfaces' },
  { feature: 'ainovel', folder: 'features/ainovel', owns: 'AI Novel engine dashboard' },
];

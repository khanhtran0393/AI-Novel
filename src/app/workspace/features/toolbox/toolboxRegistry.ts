export type ToolKey = 'batch' | 'bypass_engine';

export type ToolboxDomain = 'batch_media' | 'media_fx';

export type ToolboxItem = {
  key: ToolKey;
  label: string;
  domain: ToolboxDomain;
  /**
   * Labs = advanced / non-core loop tools.
   * Core loop: script write → TTS → image → export (not these).
   */
  labs?: boolean;
};

export const TOOLBOX_ITEMS: ToolboxItem[] = [
  { key: 'batch', label: 'Flow Agent Studio (Batch Mode)', domain: 'batch_media', labs: true },
  { key: 'bypass_engine', label: 'Phantom-X Bypass', domain: 'media_fx', labs: true },
];



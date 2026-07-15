export type ToolKey = 'nav' | 'crawler' | 'video' | 'render' | 'srt';

export type ToolboxDomain = 'navtools' | 'download' | 'video' | 'render' | 'subtitle';

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
  { key: 'nav', label: 'Media Tools (classic 6)', domain: 'navtools', labs: true },
  { key: 'crawler', label: 'Media Crawler Studio', domain: 'download', labs: true },
  { key: 'video', label: 'Video Editor Chuyen Nghiep', domain: 'video', labs: true },
  { key: 'render', label: 'Auto Render Hang Loat', domain: 'render', labs: true },
  { key: 'srt', label: 'Dich SRT Nang Cao (PRO)', domain: 'subtitle', labs: true },
];

/** LocalStorage key for showing Labs tools in toolbox menu */
export const LABS_TOOLS_STORAGE_KEY = 'ainovel.showLabsTools';

export function readShowLabsTools(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LABS_TOOLS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeShowLabsTools(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LABS_TOOLS_STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function filterToolboxItems(showLabs: boolean): ToolboxItem[] {
  if (showLabs) return TOOLBOX_ITEMS;
  // All current tools are labs — when hidden, show empty + CTA to enable
  return TOOLBOX_ITEMS.filter((it) => !it.labs);
}

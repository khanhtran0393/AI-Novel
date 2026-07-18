export type ToolKey = 'batch' | 'bypass_engine' | 'tts_batch_srt';

export type ToolboxDomain = 'batch_media' | 'media_fx' | 'tts_batch';

export type ToolboxItem = {
  key: ToolKey;
  label: string;
  domain: ToolboxDomain;
};

export const TOOLBOX_ITEMS: ToolboxItem[] = [
  { key: 'batch', label: 'Flow Agent Studio', domain: 'batch_media' },
  {
    key: 'bypass_engine',
    label: 'Phantom-X Bypass · Lách kiểm duyệt Đa hình Bất đối xứng',
    domain: 'media_fx',
  },
  {
    key: 'tts_batch_srt',
    label: 'Dịch SRT',
    domain: 'tts_batch',
  },
];

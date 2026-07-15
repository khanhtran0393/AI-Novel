export type DownloadPlatformId = 'yt' | 'tt' | 'tw' | 'rd' | 'ig';

export type DownloadMode = 'search' | 'creator' | 'detail';

export type DownloadPlatform = {
  id: DownloadPlatformId;
  label: string;
  backend: 'tai_ytdlp';
  domain: 'video-social' | 'community';
};

export const DOWNLOAD_PLATFORMS: DownloadPlatform[] = [
  { id: 'yt', label: 'YouTube', backend: 'tai_ytdlp', domain: 'video-social' },
  { id: 'tt', label: 'TikTok', backend: 'tai_ytdlp', domain: 'video-social' },
  { id: 'tw', label: 'Twitter / X', backend: 'tai_ytdlp', domain: 'video-social' },
  { id: 'rd', label: 'Reddit', backend: 'tai_ytdlp', domain: 'community' },
  { id: 'ig', label: 'Instagram', backend: 'tai_ytdlp', domain: 'video-social' },
];

export const DOWNLOAD_MODES: Array<{ id: DownloadMode; label: string }> = [
  { id: 'search', label: 'Tu khoa (Search)' },
  { id: 'creator', label: 'Theo kenh (Creator)' },
  { id: 'detail', label: 'Link truc tiep (Detail)' },
];

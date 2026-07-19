/**
 * Desktop update channel metadata (P1).
 * Actual electron-updater wiring can consume these constants.
 */

export type UpdateChannelId = 'stable' | 'beta' | 'dev';

export type UpdateChannelConfig = {
  channel: UpdateChannelId;
  feedUrl: string | null;
  checkOnLaunch: boolean;
  allowPrerelease: boolean;
};

export function resolveUpdateChannel(): UpdateChannelConfig {
  const raw = (process.env.AINOVEL_UPDATE_CHANNEL || 'stable').toLowerCase();
  const channel: UpdateChannelId =
    raw === 'beta' || raw === 'dev' ? raw : 'stable';
  const feedUrl =
    (process.env.AINOVEL_UPDATE_FEED_URL || '').trim() || null;
  return {
    channel,
    feedUrl,
    checkOnLaunch: process.env.AINOVEL_UPDATE_CHECK_ON_LAUNCH === '1',
    allowPrerelease: channel !== 'stable',
  };
}

export function getUpdatePublicStatus() {
  const cfg = resolveUpdateChannel();
  return {
    ...cfg,
    configured: Boolean(cfg.feedUrl),
    hint: cfg.feedUrl
      ? `Update channel=${cfg.channel}`
      : 'Chưa đặt AINOVEL_UPDATE_FEED_URL — auto-update tắt (manual install).',
  };
}

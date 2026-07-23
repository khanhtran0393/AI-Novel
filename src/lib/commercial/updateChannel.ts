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
  const provider = (process.env.AINOVEL_UPDATE_PROVIDER || 'github')
    .trim()
    .toLowerCase();
  const owner = (process.env.AINOVEL_UPDATE_GITHUB_OWNER || 'khanhtran0393').trim();
  const repo = (
    process.env.AINOVEL_UPDATE_GITHUB_REPO || 'AI-Novel-release-'
  ).trim();
  const githubUrl = `https://github.com/${owner}/${repo}/releases`;
  const genericUrl = (process.env.AINOVEL_UPDATE_FEED_URL || '').trim() || null;
  // Prefer github URL for status when provider=github; dual-feed still has generic.
  const feedUrl =
    provider === 'github' ? githubUrl : genericUrl || githubUrl;
  return {
    channel,
    feedUrl,
    checkOnLaunch: process.env.AINOVEL_UPDATE_CHECK_ON_LAUNCH !== '0',
    allowPrerelease: channel !== 'stable',
  };
}

export function getUpdatePublicStatus() {
  const cfg = resolveUpdateChannel();
  const provider = (process.env.AINOVEL_UPDATE_PROVIDER || 'github')
    .trim()
    .toLowerCase();
  const owner = (process.env.AINOVEL_UPDATE_GITHUB_OWNER || 'khanhtran0393').trim();
  const repo = (
    process.env.AINOVEL_UPDATE_GITHUB_REPO || 'AI-Novel-release-'
  ).trim();
  const genericUrl = (process.env.AINOVEL_UPDATE_FEED_URL || '').trim() || null;
  return {
    ...cfg,
    provider: provider === 'generic' ? 'generic' : 'github',
    github: { owner, repo },
    genericFeedUrl: genericUrl,
    dualFeed: Boolean(genericUrl),
    /**
     * Policy C': check → auto download (stage) → install on **next** launch.
     * See electron/updater.js
     */
    policy: 'C_download_ready_install_next_launch' as const,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    installOnNextLaunch: true,
    configured: Boolean(cfg.feedUrl),
    hint: cfg.feedUrl
      ? `GitHub ${owner}/${repo}` +
        (genericUrl ? ' + Supabase fallback' : '') +
        ' · tự tải, cài lần mở sau'
      : 'Chưa cấu hình update feed — cài tay installer mới.',
  };
}

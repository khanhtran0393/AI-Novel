'use strict';

const os = require('os');
const crypto = require('crypto');

/**
 * Environment fingerprint containing only technical, non-personal data:
 * platform, OS build, architecture, runtime versions and a stable
 * configuration hash. Locale and timezone identifiers are intentionally not
 * collected (privacy minimization); only the numeric UTC offset is included.
 */
function environmentProfile() {
  let osRelease = '';
  let arch = '';
  let platform = '';
  try { osRelease = os.release() || ''; } catch (_) {}
  try { arch = os.arch() || ''; } catch (_) {}
  try { platform = os.platform() || ''; } catch (_) {}

  const versions = {
    node: (process.versions && process.versions.node) || '',
    electron: (process.versions && process.versions.electron) || '',
    chrome: (process.versions && process.versions.chrome) || '',
  };

  const configBasis = [platform, arch, osRelease, versions.node, versions.electron].join('|');
  const environment_id = crypto.createHash('sha256').update(configBasis, 'utf8').digest('hex').slice(0, 24);

  let osName = platform;
  if (platform === 'win32') osName = 'Windows';
  else if (platform === 'darwin') osName = 'macOS';
  else if (platform === 'linux') osName = 'Linux';

  return {
    environment_id,
    OS: osName,
    'OS build': osRelease,
    architecture: arch,
    runtime: 'node',
    'dependency versions': versions,
    'configuration fingerprint': environment_id,
    locale: null,
    timezone: null,
    timezone_offset_minutes: -new Date().getTimezoneOffset(),
  };
}

module.exports = { environmentProfile };
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const packages = [];
for (const [relative, meta] of Object.entries(lock.packages || {})) {
  if (!relative.includes('node_modules/') || meta.dev === true || meta.link === true) continue;
  const packageJsonPath = path.join(root, relative, 'package.json');
  if (!fs.existsSync(packageJsonPath)) continue;
  const local = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packages.push({
    name: local.name || relative.split('node_modules/').at(-1),
    version: local.version || meta.version || 'unknown',
    license: local.license || local.licenses || 'UNKNOWN',
    homepage: local.homepage || null,
    repository:
      typeof local.repository === 'string'
        ? local.repository
        : local.repository?.url || null,
    integrity: meta.integrity || null,
  });
}
packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

const noticePath = path.join(root, 'docs', 'NPM_DEPENDENCY_NOTICE.json');
fs.writeFileSync(
  noticePath,
  `${JSON.stringify({ app: appPackage.name, version: appPackage.version, packages }, null, 2)}\n`,
  'utf8',
);

const fontsDir = path.join(root, 'vendor', 'FableCut', 'library', 'fonts');
const fontLines = fs
  .readdirSync(fontsDir)
  .filter((name) => /\.(?:woff2?|ttf|otf)$/i.test(name))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const hash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(fontsDir, name)))
      .digest('hex');
    return `${hash}  ${name}`;
  });
const fontSumsPath = path.join(fontsDir, 'SHA256SUMS.txt');
fs.writeFileSync(fontSumsPath, `${fontLines.join('\n')}\n`, 'utf8');

console.log(
  JSON.stringify({
    ok: true,
    packages: packages.length,
    notice: path.relative(root, noticePath),
    fonts: fontLines.length,
    fontChecksums: path.relative(root, fontSumsPath),
  }),
);

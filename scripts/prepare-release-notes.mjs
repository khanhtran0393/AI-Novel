/**
 * Ensure release-notes.json is ready for ship:
 * - resources/commercial/release-notes.json exists
 * - Current package.json version has a notes block (create stub if missing)
 * - Stamp packedAt for audit
 *
 * Usage:
 *   node scripts/prepare-release-notes.mjs
 *   node scripts/prepare-release-notes.mjs --require-items   # fail if current version has 0 items
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NOTES_PATH = path.join(ROOT, 'resources', 'commercial', 'release-notes.json');
const PKG_PATH = path.join(ROOT, 'package.json');
const REQUIRE_ITEMS = process.argv.includes('--require-items');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  if (!fs.existsSync(PKG_PATH)) {
    console.error('[release-notes] missing package.json');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const version = String(pkg.version || '').trim();
  if (!version) {
    console.error('[release-notes] package.json missing version');
    process.exit(1);
  }

  let doc = {
    schema: 'ainovel.release-notes.v1',
    product: 'AI Novel',
    versions: {},
  };
  if (fs.existsSync(NOTES_PATH)) {
    try {
      doc = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));
    } catch (e) {
      console.error('[release-notes] invalid JSON:', e?.message || e);
      process.exit(1);
    }
  }
  if (!doc.versions || typeof doc.versions !== 'object') {
    doc.versions = {};
  }
  doc.schema = doc.schema || 'ainovel.release-notes.v1';
  doc.product = doc.product || 'AI Novel';

  const existing = doc.versions[version];
  if (!existing) {
    // Stub so pack never ships without a key for current version
    doc.versions[version] = {
      date: today(),
      title: `Bản ${version}`,
      items: [
        `Phát hành AI Novel ${version}.`,
        'Xem chi tiết thay đổi trong release notes / thông báo cập nhật.',
      ],
      packedAt: new Date().toISOString(),
      autoStub: true,
    };
    console.warn(
      `[release-notes] created stub for v${version} — hãy bổ sung items thật trước ship production`,
    );
  } else {
    const items = Array.isArray(existing.items) ? existing.items.filter(Boolean) : [];
    if (REQUIRE_ITEMS && items.length === 0) {
      console.error(
        `[release-notes] v${version} has 0 items — add changelog bullets before pack`,
      );
      process.exit(2);
    }
    doc.versions[version] = {
      ...existing,
      date: existing.date || today(),
      items: items.length
        ? items
        : [
            `Phát hành AI Novel ${version}.`,
            'Xem chi tiết thay đổi trong release notes / thông báo cập nhật.',
          ],
      packedAt: new Date().toISOString(),
    };
  }

  fs.mkdirSync(path.dirname(NOTES_PATH), { recursive: true });
  fs.writeFileSync(NOTES_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  const n = (doc.versions[version].items || []).length;
  console.log(
    `[release-notes] OK path=${NOTES_PATH} version=${version} items=${n} packedAt=${doc.versions[version].packedAt}`,
  );
}

main();

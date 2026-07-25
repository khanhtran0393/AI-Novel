/**
 * Empirical: character reference sheet disk uniqueness + persist wiring.
 * Run: npx tsx scripts/smoke-char-sheet-persist.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  localCharacterSheetFilename,
  localCharacterWardrobeFilename,
  localImageFilename,
  sanitizeAssetFilename,
  characterImageKey,
  safeDiskToken,
} from '../src/contracts/keys.ts';

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

section('unique filenames per character');
const a = localCharacterSheetFilename('Hàn Dực');
const b = localCharacterSheetFilename('Liễu Yên');
const legacy = localImageFilename(0, 999, 999);
assert.equal(a, 'char_sheet_Hàn_Dực.png');
assert.equal(b, 'char_sheet_Liễu_Yên.png');
assert.notEqual(a, b, 'two chars must not share disk file');
assert.notEqual(a, legacy, 'must not use shared chapter_0_scene_999_prompt_999.png');
assert.equal(legacy, 'chapter_0_scene_999_prompt_999.png');
console.log('OK', { a, b, legacy });

section('wardrobe unique');
const w1 = localCharacterWardrobeFilename('Hàn Dực', 'battle');
const w2 = localCharacterWardrobeFilename('Hàn Dực', 'daily');
assert.notEqual(w1, w2);
assert.ok(w1.includes('wardrobe_battle'));
console.log('OK', { w1, w2 });

section('sanitizeAssetFilename');
assert.equal(sanitizeAssetFilename('char_sheet_Test.png'), 'char_sheet_Test.png');
assert.equal(sanitizeAssetFilename('../etc/passwd.png'), 'passwd.png'); // basename only
assert.equal(sanitizeAssetFilename('evil.exe'), '');
assert.equal(sanitizeAssetFilename(''), '');
assert.equal(
  sanitizeAssetFilename('path/to/char_sheet_Hàn_Dực.png'),
  'char_sheet_Hàn_Dực.png',
);
console.log('OK sanitize');

section('safeDiskToken');
assert.equal(safeDiskToken('A/B:C'), 'A_B_C');
assert.equal(safeDiskToken(''), 'asset');
console.log('OK token');

section('source wiring — no empty placeholder + assetFilename');
{
  const hooks = fs.readFileSync(
    path.join(process.cwd(), 'src/app/workspace/hooks/useCharacterActions.ts'),
    'utf8',
  );
  // Must NOT clear sheet with empty string before gen
  assert.ok(
    !hooks.includes("addGeneratedImage(charKey, '')") &&
      !hooks.includes('addGeneratedImage(charKey, "")'),
    'must not clear sheet with empty path before gen',
  );
  assert.ok(hooks.includes('durablePath'), 'must persist durablePath to face_ref');
  assert.ok(hooks.includes('restoreSheetFromFaceRef'), 'must restore sheet from face_ref');

  const mod = fs.readFileSync(
    path.join(process.cwd(), 'src/app/workspace/modules/characterModule.ts'),
    'utf8',
  );
  assert.ok(mod.includes('assetFilename'), 'client must send assetFilename');
  assert.ok(mod.includes('localCharacterSheetFilename'));
  assert.ok(mod.includes('toServeImageUrl'));

  const route = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/generate-image/route.ts'),
    'utf8',
  );
  assert.ok(route.includes('sanitizeAssetFilename'), 'API must honor assetFilename');

  const serve = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/serve-image/route.ts'),
    'utf8',
  );
  assert.ok(serve.includes("searchParams.get('path')"), 'serve-image must support path=');

  const form = fs.readFileSync(
    path.join(process.cwd(), 'src/app/workspace/features/script/CharacterProfileForm.tsx'),
    'utf8',
    );
  assert.ok(form.includes('face_ref'), 'UI falls back to face_ref');
  console.log('OK wiring');
}

section('store key vs disk file');
assert.equal(characterImageKey('Hàn Dực'), 'char_Hàn Dực');
assert.notEqual(characterImageKey('Hàn Dực'), localCharacterSheetFilename('Hàn Dực'));
console.log('OK store key char_Name · disk char_sheet_Name.png');

// Optional: write two distinct buffers to public/images and verify no clash
section('disk isolation write (local public/images)');
{
  const dir = path.join(process.cwd(), 'public', 'images');
  fs.mkdirSync(dir, { recursive: true });
  const f1 = path.join(dir, localCharacterSheetFilename('SmokeCharA'));
  const f2 = path.join(dir, localCharacterSheetFilename('SmokeCharB'));
  const pngTiny = Buffer.from(
    // minimal 1x1 PNG
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(f1, pngTiny);
  fs.writeFileSync(f2, pngTiny);
  assert.ok(fs.existsSync(f1) && fs.existsSync(f2));
  assert.notEqual(f1, f2);
  // overwrite A must not delete B
  fs.writeFileSync(f1, pngTiny);
  assert.ok(fs.existsSync(f2), 'writing A must not remove B');
  console.log('OK disk isolation', {
    f1: path.basename(f1),
    f2: path.basename(f2),
    sizeA: fs.statSync(f1).size,
    sizeB: fs.statSync(f2).size,
  });
}

console.log('\n=== ALL PASS: smoke-char-sheet-persist ===');

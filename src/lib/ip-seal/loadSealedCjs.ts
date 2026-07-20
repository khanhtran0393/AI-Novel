/**
 * Load AES-sealed CommonJS crown modules into memory (no plain file on disk in pack).
 */
import fs from 'fs';
import path from 'path';
import Module from 'module';
import { unsealCrownUtf8 } from '@/lib/ip-seal/crownCrypto';
import { resolveCrownSealPath } from '@/lib/ip-seal/paths';

const cache = new Map<string, unknown>();

/**
 * @param moduleId seal id (e.g. bypass-formulas) — must match seal script
 * @param filename seal file base (default = moduleId)
 */
export function loadSealedCjsModule<T = Record<string, unknown>>(
  moduleId: string,
  filename?: string,
): T {
  const key = `${moduleId}::${filename || moduleId}`;
  if (cache.has(key)) {
    return cache.get(key) as T;
  }
  const sealPath = resolveCrownSealPath(filename || moduleId);
  if (!fs.existsSync(sealPath)) {
    throw new Error(
      `Crown seal missing: ${sealPath}. Chạy npm run crown:seal trước khi pack/build sealed.`,
    );
  }
  const sealed = fs.readFileSync(sealPath);
  const code = unsealCrownUtf8(sealed, moduleId);
  const mod = new Module(sealPath);
  mod.filename = sealPath;
  mod.paths = (Module as unknown as { _nodeModulePaths: (p: string) => string[] })._nodeModulePaths(
    path.dirname(sealPath),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mod as any)._compile(code, sealPath);
  const exports = mod.exports as T;
  cache.set(key, exports);
  return exports;
}

export function clearCrownModuleCache(): void {
  cache.clear();
}

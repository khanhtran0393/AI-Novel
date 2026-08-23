/**
 * 5-Hour Access Token In-Memory Cache for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Caches access tokens per `profileId` with a 5-hour TTL (`5 * 60 * 60 * 1000`)
 * to prevent spamming Google's `/api/auth/session` endpoint during batch generation tasks.
 */

export interface CachedTokenEntry {
  token: string;
  expiresAt: number;
}

export class AccountTokenCache {
  private cache: Map<string, CachedTokenEntry> = new Map();
  private readonly TOKEN_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

  getCachedToken(profileId: string): string | null {
    const entry = this.cache.get(profileId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      console.log(`[AccountTokenCache] Token expired for profile ${profileId}`);
      this.cache.delete(profileId);
      return null;
    }

    console.log(`[AccountTokenCache] Returning cached token for profile ${profileId} (TTL valid)`);
    return entry.token;
  }

  setCachedToken(profileId: string, token: string) {
    if (!token || token.trim().length === 0) return;

    const expiresAt = Date.now() + this.TOKEN_TTL_MS;
    this.cache.set(profileId, { token, expiresAt });
    console.log(`[AccountTokenCache] Cached token for profile ${profileId} (Expires in 5 hours)`);
  }

  clearCachedToken(profileId: string) {
    this.cache.delete(profileId);
    console.log(`[AccountTokenCache] Cleared token cache for profile ${profileId}`);
  }

  clearAll() {
    this.cache.clear();
  }
}

export const accountTokenCache = new AccountTokenCache();

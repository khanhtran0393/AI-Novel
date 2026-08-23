/**
 * Global Proxy Manager & Failover Rotation for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Supports HTTP, HTTPS, and SOCKS5 proxies. Automatically tracks proxy health,
 * rotates proxies on 403 / 429 errors, and provides proxy URLs to tlsFetch.
 */

export interface ProxyConfig {
  url: string; // e.g. "http://user:pass@host:port" or "socks5://host:port"
  protocol: 'http' | 'https' | 'socks5' | 'socks4';
  host: string;
  port: number;
  username?: string;
  password?: string;
  failsCount: number;
  lastUsedAt: number;
}

class GlobalProxyManager {
  private proxies: ProxyConfig[] = [];
  private proxyByProfile = new Map<string, string>();
  private activeProxyIndex = 0;

  public setProxies(urls: string[]): void {
    this.proxies = urls.map((u) => this.parseProxyUrl(u)).filter(Boolean) as ProxyConfig[];
    this.activeProxyIndex = 0;
    console.log(`[ProxyManager] Loaded ${this.proxies.length} proxy endpoints`);
  }

  public parseProxyUrl(proxyUrl: string): ProxyConfig | null {
    try {
      const u = new URL(proxyUrl);
      const protocol = (u.protocol.replace(':', '') || 'http') as any;
      return {
        url: proxyUrl,
        protocol,
        host: u.hostname,
        port: Number(u.port) || (protocol === 'https' ? 443 : 80),
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        failsCount: 0,
        lastUsedAt: 0,
      };
    } catch {
      return null;
    }
  }

  public getProxyForProfile(profileId: string): string | undefined {
    if (this.proxies.length === 0) {
      return process.env.VEO3_HTTP_PROXY || process.env.HTTP_PROXY || undefined;
    }
    let pUrl = this.proxyByProfile.get(profileId);
    if (!pUrl) {
      const p = this.proxies[this.activeProxyIndex % this.proxies.length];
      this.activeProxyIndex = (this.activeProxyIndex + 1) % this.proxies.length;
      pUrl = p.url;
      this.proxyByProfile.set(profileId, pUrl);
    }
    return pUrl;
  }

  public rotateProxyOnFailure(profileId: string, reason: string): string | undefined {
    const current = this.proxyByProfile.get(profileId);
    if (current) {
      const p = this.proxies.find((x) => x.url === current);
      if (p) p.failsCount += 1;
    }

    if (this.proxies.length <= 1) {
      return current;
    }

    // Pick next proxy with lowest fails
    const available = [...this.proxies].sort((a, b) => a.failsCount - b.failsCount);
    const nextProxy = available[0].url === current ? available[1]?.url : available[0]?.url;

    if (nextProxy) {
      this.proxyByProfile.set(profileId, nextProxy);
      console.warn(`[ProxyManager] Rotated proxy for profile ${profileId.slice(0, 8)} (${reason}) -> ${nextProxy.replace(/\/\/[^@]+@/, '//***@')}`);
      return nextProxy;
    }
    return current;
  }

  public getCurrentHttpProxyUrl(): string | undefined {
    return this.getProxyForProfile('default');
  }
}

export const globalProxyManager = new GlobalProxyManager();

import type { NextConfig } from "next";

const devScriptPolicy = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${devScriptPolicy}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // music-metadata v11 exposes the Node entry through the `module-sync`
  // condition. CutSDK's compiled CJS uses require(), while Turbopack does not
  // currently select that condition, so pin the equivalent Node entry.
  turbopack: {
    resolveAlias: {
      "music-metadata": "./node_modules/music-metadata/lib/index.js",
    },
  },
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "puppeteer-extra",
    "puppeteer-extra-plugin-stealth"
  ],
  // Electron loads http://127.0.0.1:3000 — allow HMR/dev assets (không block click/hot reload)
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  // Native /api/ainovel/* — không còn proxy ainovel-gui :8080
};

export default nextConfig;

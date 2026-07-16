import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "puppeteer-extra",
    "puppeteer-extra-plugin-stealth",
    "music-metadata"
  ],
  // Electron loads http://127.0.0.1:3000 — allow HMR/dev assets (không block click/hot reload)
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Native /api/ainovel/* — không còn proxy ainovel-gui :8080
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "puppeteer-extra",
    "puppeteer-extra-plugin-stealth",
    "music-metadata"
  ],
  // Native /api/ainovel/* — không còn proxy ainovel-gui :8080
};

export default nextConfig;

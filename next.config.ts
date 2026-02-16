import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: process.env.BUILD_DIR || '.next',
  // Note: COEP/COOP headers are NOT applied globally because they conflict
  // with Sandpack's Nodebox. WebContainer pages apply COEP via meta tag instead.
};

export default nextConfig;

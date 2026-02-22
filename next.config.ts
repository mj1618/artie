import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: process.env.BUILD_DIR || '.next',
};

export default nextConfig;

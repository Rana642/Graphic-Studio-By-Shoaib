import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default 1MB is too small for reference-image uploads (server action).
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;

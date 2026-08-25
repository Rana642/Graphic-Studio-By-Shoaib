import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default 1MB is too small for reference-image uploads (server action).
    serverActions: { bodySizeLimit: "10mb" },
  },
  // @resvg/resvg-js ships a native binary loaded via a plain require() —
  // Turbopack can't place that inside an ESM chunk (same category of issue
  // Next.js already works around for `sharp` by default). Keep it as a
  // real require() from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;

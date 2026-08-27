import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a builtin — keep it out of the bundler graph.
  serverExternalPackages: ["node:sqlite"],
  experimental: {
    // Server Actions receive CSV uploads.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  reactStrictMode: false,
  output: "standalone",
  transpilePackages: ["three"],
  serverExternalPackages: [],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  reactStrictMode: false,
  output: "standalone",
  transpilePackages: ["three"],
  serverExternalPackages: [],
  async headers() {
    return [{ source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;

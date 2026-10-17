import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // drei <Html> creates/unmounts React roots in layout effects; StrictMode's double-invoke logs a noisy dev-only error.
  reactStrictMode: false,
  output: "standalone",
  transpilePackages: ["three"],
  async headers() {
    const year = "public, max-age=31536000, immutable";
    return [
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: year }] },
      { source: "/hdri/:path*", headers: [{ key: "Cache-Control", value: year }] },
      { source: "/textures/:path*", headers: [{ key: "Cache-Control", value: year }] },
      { source: "/:path*.(png|jpg|jpeg|webp|svg|avif)", headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }] },
    ];
  },
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/v1/:path*", destination: `${backend}/v1/:path*` },
    ];
  },
};

export default nextConfig;

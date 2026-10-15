import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  // Preserve the incoming query so Proxy can reject prototype keys before Next normalizes them away.
  skipProxyUrlNormalize: true,
  experimental: {
    serverActions: {
      // Extra hosts the app is opened at (e.g. through `tailscale serve`), comma-separated.
      // Set at build time; see deploy/compose.yaml.
      allowedOrigins: (process.env.NPINV_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

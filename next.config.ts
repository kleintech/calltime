import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Load the Neon driver and Drizzle from node_modules instead of bundling them. Bundled, the
   * Pool class drizzle checks with `instanceof` can be a different copy from the one we construct,
   * so db.transaction() silently falls back to sending BEGIN/COMMIT over arbitrary pooled
   * connections — which left connections stuck mid-transaction and lost writes.
   */
  serverExternalPackages: ["@neondatabase/serverless", "drizzle-orm", "ws"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Several pages carry a secret in the URL (invite, audition manage, calendar feed); never leak it via Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

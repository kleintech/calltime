import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Load the Neon driver and Drizzle from node_modules instead of bundling them. Bundled, the
   * Pool class drizzle checks with `instanceof` can be a different copy from the one we construct,
   * so db.transaction() silently falls back to sending BEGIN/COMMIT over arbitrary pooled
   * connections — which left connections stuck mid-transaction and lost writes.
   */
  serverExternalPackages: ["@neondatabase/serverless", "drizzle-orm", "ws"],
};

export default nextConfig;

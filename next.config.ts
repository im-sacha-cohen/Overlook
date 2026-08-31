import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is only for the Docker image. Vercel sets its own
  // build tracing (`.nft.json`) and breaks if "standalone" is forced, so
  // skip it there — Vercel sets VERCEL=1 automatically during builds.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["better-sqlite3", "pg", "mysql2"],
};

export default nextConfig;

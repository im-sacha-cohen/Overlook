import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pg", "mysql2"],
  output: "standalone",
};

export default nextConfig;

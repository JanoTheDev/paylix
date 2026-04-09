import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@paykit/db"],
};

export default nextConfig;

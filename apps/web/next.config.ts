import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@el-dorado/db", "@el-dorado/shared"],
};

export default nextConfig;

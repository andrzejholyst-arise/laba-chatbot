import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/": ["./materiały/dane/wiadomosci_testowe.csv"],
  },
};

export default nextConfig;

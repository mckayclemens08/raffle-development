import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge (the "N issues" pill, bottom-left) only ever renders
  // during local development — a production build never includes it, so it was
  // never going to appear on the live site. Hidden anyway because it sat over
  // the page and read like a fault in the app. Compile and runtime errors are
  // still surfaced.
  devIndicators: false,
};

export default nextConfig;

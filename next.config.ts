import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Ensure monorepo root is explicit for Turbopack/workspace tracing on Vercel.
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  turbopack: {
    root: path.join(process.cwd(), '../..'),
  },
};

export default nextConfig;

import fs from 'fs';
import path from 'path';
import type { NextConfig } from 'next';

const cwd = process.cwd();
const monorepoRoot = path.resolve(cwd, '../..');
const isDashboardInMonorepo =
  fs.existsSync(path.join(monorepoRoot, 'apps', 'dashboard')) &&
  fs.existsSync(path.join(monorepoRoot, 'package.json'));
const projectRoot = isDashboardInMonorepo ? monorepoRoot : cwd;

const nextConfig: NextConfig = {
  // Use monorepo root only when this app is actually nested inside one.
  // This prevents invalid traced paths in single-repo Vercel deployments.
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;

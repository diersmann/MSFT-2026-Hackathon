import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  transpilePackages: ['@dispatch/core'],
  // App Service receives only this traced bundle. The tracing root must be the
  // monorepo root so the workspace dependency on @dispatch/core is included.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};

export default config;

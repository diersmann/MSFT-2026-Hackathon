import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  transpilePackages: ['@dispatch/core'],
  // The dashboard has API routes and server-rendered pages, so it needs a Node
  // server rather than static hosting. `standalone` emits that server plus only
  // the traced dependencies, which keeps both container and App Service
  // deployments small.
  output: 'standalone',
  // Without this, tracing stops at packages/dashboard and the workspace
  // dependency on @dispatch/core is left out of the standalone bundle.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};

export default config;

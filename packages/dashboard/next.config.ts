import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@dispatch/core'],
  // The dashboard has API routes and server-rendered pages, so it needs a Node
  // server rather than static hosting. `standalone` emits that server plus only
  // the traced dependencies, which is what makes the container small.
  output: 'standalone',
  // Without this, tracing stops at packages/dashboard and the workspace
  // dependency on @dispatch/core is left out of the standalone bundle.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;

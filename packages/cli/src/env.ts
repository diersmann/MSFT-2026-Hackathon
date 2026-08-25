import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/**
 * Loads .env from the repository root rather than the process cwd.
 *
 * npm runs workspace scripts with cwd set to the package directory, so
 * `dotenv/config` looked for packages/cli/.env and silently found nothing —
 * which surfaced as "no model backend configured" despite a filled-in root .env.
 */
export function loadEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  config();
}

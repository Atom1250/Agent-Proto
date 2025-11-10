import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function run(command) {
  console.log(`$ ${command}`);
  execSync(command, { stdio: 'inherit', cwd: repoRoot });
}

const prismaCachePath = resolve(repoRoot, 'node_modules/.prisma');

try {
  rmSync(prismaCachePath, { recursive: true, force: true });
  console.log(`Removed ${prismaCachePath}`);
} catch (error) {
  console.warn(`Warning: unable to remove ${prismaCachePath}:`, error);
}

run('pnpm rebuild @prisma/client');
run('pnpm --filter @agent-proto/api exec prisma generate');


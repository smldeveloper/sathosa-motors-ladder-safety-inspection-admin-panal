import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', '--test-timeout=60000', 'tests/server.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE: '1' }
});
process.exit(result.status ?? 1);

// Runs the loader tests with V8 coverage, then checks the line minimum.
// Plain Node, so it works on each OS (no `rm -rf`, no `VAR=value cmd`).

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const dir = 'target/js-coverage';
rmSync(dir, { recursive: true, force: true });
const env = { ...process.env, LOADER_COVERAGE: dir };
const run = (args) => spawnSync(process.execPath, args, { env, stdio: 'inherit', shell: false });

const tests = run(['--test', '--test-concurrency=1', '--test-timeout=30000', 'js-tests/*.test.mjs']);
if (tests.status !== 0) process.exit(tests.status ?? 1);
const report = run(['js-tests/coverage-report.mjs']);
process.exit(report.status ?? 1);

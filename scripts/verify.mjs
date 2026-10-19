import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run this command with npm run verify');
const checks = [
  'format:check',
  'sql:check',
  'docs:check',
  'edge:check',
  'test',
  'build',
  'build:budget',
  'test:ai:edge',
  'test:browser',
  'test:browser:offline',
];
const results = [];
let built = false;
for (const name of checks) {
  if (['build:budget', 'test:browser:offline'].includes(name) && !built) {
    results.push({ name, status: 'skipped', reason: 'build failed' });
    continue;
  }
  const child = spawn(process.execPath, [npm, 'run', name], { stdio: 'inherit' });
  const code = await new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (name === 'build') built = code === 0;
  results.push({ name, status: code === 0 ? 'passed' : 'failed' });
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/verification.json', JSON.stringify(results, null, 2) + '\n');
console.table(results);
if (results.some((r) => r.status !== 'passed')) process.exitCode = 1;

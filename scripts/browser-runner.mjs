import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { browserExecutable } from '../tests/browser-runtime.mjs';
const mode = process.argv.includes('--smoke')
  ? 'smoke'
  : process.argv.includes('--offline')
    ? 'offline'
    : 'all';
const smoke = [
  'app-recovery',
  'auth',
  'weekly-schedule',
  'course-world',
  'search',
  'submission-draft',
  'navigation',
];
const production = [
  'offline',
  'download-offline',
  'day-offline',
  'navigation-production',
  'submission-draft-production',
  'bootstrap-production',
].map((name) => name + '.browser.mjs');
const files = (await readdir('tests'))
  .filter(
    (n) =>
      n.endsWith('.browser.mjs') &&
      (mode === 'all'
        ? !production.includes(n)
        : mode === 'offline'
          ? production.includes(n)
          : smoke.some((s) => n === s + '.browser.mjs')),
  )
  .sort();
await mkdir('test-results', { recursive: true });
const port = mode === 'offline' ? 4180 : 5184;
const base = `http://127.0.0.1:${port}`;
const vite = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(mode === 'offline' ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverLog = '';
vite.stdout.on('data', (d) => (serverLog += d));
vite.stderr.on('data', (d) => (serverLog += d));
let killed = false;
const stop = () => {
  if (!killed) {
    killed = true;
    vite.kill('SIGTERM');
  }
};
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (vite.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error('Vite failed to start: ' + serverLog);
  for (const file of files) {
    const source = await readFile('tests/' + file, 'utf8');
    const env = { ...process.env, CHROMIUM_PATH: browserExecutable };
    // Preserve the existing scripts, while giving every scenario the same managed server.
    for (const match of source.matchAll(/process\.env\.([A-Z_]*(?:URL))/g))
      env[match[1]] = match[1] === 'AUTH_TEST_URL' ? base + '/' : base + '/?demo=1';
    env.NOTES_TEST_LIVE = '0';
    env.STUDY_TEST_URL = base + '/?demo=1';
    // Existing fixtures use Chromium at this path; CI provisions it explicitly.
    const child = spawn(process.execPath, ['tests/' + file], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      output += d;
      process.stderr.write(d);
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
    const code = await new Promise((resolve) => {
      child.on('error', (e) => {
        output += e.message;
        resolve(1);
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
    clearTimeout(timer);
    await writeFile('test-results/' + file + '.log', output);
    results.push({ file, passed: code === 0 });
  }
} finally {
  stop();
  await writeFile(
    'test-results/browser-' + mode + '.json',
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  'Browser scenarios: ' +
    results.filter((r) => r.passed).length +
    '/' +
    results.length +
    ' passed.',
);
if (results.some((r) => !r.passed)) process.exitCode = 1;

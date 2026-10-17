import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const files = (await readdir('tests')).filter((n) => /\.test\.(mjs|tsx?)$/.test(n)).sort();
const resultDir = join('test-results', 'node-' + process.versions.node);
await mkdir(resultDir, { recursive: true });
const results = [];
for (const file of files) {
  const sql = ['database.test.mjs', 'upgrade.test.mjs'].includes(file);
  const args = sql ? [join('tests', file)] : ['--import', 'tsx', '--test', join('tests', file)];
  const start = Date.now();
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => {
    output += d;
    process.stdout.write(d);
  });
  child.stderr.on('data', (d) => {
    output += d;
    process.stderr.write(d);
  });
  const code = await new Promise((resolve) => {
    child.on('error', (e) => {
      output += e.message;
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
  await writeFile(join(resultDir, file + '.log'), output);
  results.push({ file, passed: code === 0, durationMs: Date.now() - start });
}
await writeFile(join(resultDir, 'unit-summary.json'), JSON.stringify(results, null, 2) + '\n');
console.log(
  '\nSuites: ' + results.filter((r) => r.passed).length + '/' + results.length + ' passed.',
);
if (results.some((r) => !r.passed)) process.exitCode = 1;

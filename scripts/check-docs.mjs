import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const files = [
  'README.md',
  'HANDOFF.md',
  'docs/database-workflow.md',
  'docs/deployment-current.md',
  'docs/pilot-readiness.md',
];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (!file.startsWith('docs/') && !text.split('\n')[0].includes('v' + version))
    throw Error(file + ' has an outdated version');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    await access(resolve(dirname(file), target));
  }
}
console.log('Current documentation versions and local links are valid.');

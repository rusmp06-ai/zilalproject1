import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)?.[1];
const style = html.match(/<link[^>]*href="([^"]+\.css)"[^>]*>/)?.[1];
if (!script || !style) throw Error('Build assets were not found. Run npm run build first.');
const js = (await readFile('dist/' + script.replace(/^\//, ''), 'utf8')).replace(
  /<\/script/gi,
  '<\\/script',
);
const css = await readFile('dist/' + style.replace(/^\//, ''), 'utf8');
await writeFile(
  'preview.html',
  html
    .replace(
      /<script[^>]*src="[^"]+"[^>]*><\/script>/,
      () => `<script type="module">${js}</script>`,
    )
    .replace(/<link[^>]*href="[^"]+\.css"[^>]*>/, () => `<style>${css}</style>`),
);
console.log('Created standalone preview.html');
